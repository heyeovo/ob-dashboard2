// cc 引擎的会话保持层（服务端专用，进程内单例）。
//
// 为什么要这个：每个 query() 启动都要把系统提示 + 27 个工具定义写进 Anthropic 的
// prompt cache，实测 cache_creation_input_tokens ≈ 33500 / ≈ $0.27，只回两个字也一样。
// 所以「一句话一个 query()」等于每轮重付一次。
//
// ⚠️ 别把两件事搞混：
//   · prompt cache 在 Anthropic 那边，TTL 5 分钟，命中会续期。留住它靠**说话间隔短**，
//     跟这里的连接开不开无关 —— 连接挂着也留不住过期的缓存。
//   · 这里保住的是**子进程**（省掉每轮 init 的 ~2.5s）和**上下文连续性**
//     （streaming input 模式下同一个 query 里多轮对话，历史不用重发）。
//
// 实现方式：streaming input（prompt 传 AsyncIterable<SDKUserMessage>）。一个 query()
// 从会话第一句活到闲置回收，中间每句话往那个 iterable 里 push 一条 user 消息。

import { query, type Query, type SDKMessage, type SDKUserMessage, type Options } from '@anthropic-ai/claude-agent-sdk'

/** 闲置多久回收子进程。跟 prompt cache 的 5 分钟没关系，纯粹是别让子进程无限堆着。 */
const IDLE_TTL_MS = 10 * 60 * 1000

/** Anthropic prompt cache 的 TTL，用来算「缓存还有多久过期」给界面显示。 */
export const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000

/** 一个会话在服务端的活体状态。 */
type LiveSession = {
  sessionId: string
  q: Query
  /** query() 的 prompt 那个 AsyncIterable 的推送端 */
  push: (msg: SDKUserMessage) => void
  close: () => void
  /** for await 出来的消息流，多轮共用一个 iterator */
  iterator: AsyncIterator<SDKMessage>
  /** claude code 自己的 session_id，第一条 init 事件里拿到，供排查用 */
  ccSessionId: string
  createdAt: number
  lastActiveAt: number
  /** 这个会话累计花的钱（result 事件里的 total_cost_usd 累加） */
  totalCostUsd: number
  turnCount: number
  /** 最后一次真正打到模型的时间，用来算 prompt cache 还有多久过期 */
  lastModelCallAt: number
  /** 正在跑一轮吗 —— 同一个会话不允许并发发言（一个 iterator 只能一个消费者） */
  busy: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
}

// dev 模式下 Next 会热重载模块，挂在 globalThis 上才不会每次改代码就丢掉所有会话
const REGISTRY_KEY = '__ob2_cc_sessions__'
type Registry = Map<string, LiveSession>
const registry: Registry =
  (globalThis as unknown as Record<string, Registry>)[REGISTRY_KEY] ||
  ((globalThis as unknown as Record<string, Registry>)[REGISTRY_KEY] = new Map())

/** 手写的异步队列：一端 push，另一端 for await。SDK 的 streaming input 要的就是这个。 */
function createMessageQueue() {
  const pending: SDKUserMessage[] = []
  let waiter: ((v: IteratorResult<SDKUserMessage>) => void) | null = null
  let closed = false

  const iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<SDKUserMessage>> {
          if (pending.length > 0) {
            return Promise.resolve({ value: pending.shift()!, done: false })
          }
          if (closed) return Promise.resolve({ value: undefined as never, done: true })
          return new Promise((resolve) => {
            waiter = resolve
          })
        },
        return(): Promise<IteratorResult<SDKUserMessage>> {
          closed = true
          return Promise.resolve({ value: undefined as never, done: true })
        },
      }
    },
  }

  return {
    iterable,
    push(msg: SDKUserMessage) {
      if (closed) return
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value: msg, done: false })
      } else {
        pending.push(msg)
      }
    },
    close() {
      closed = true
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value: undefined as never, done: true })
      }
    },
  }
}

function armIdleTimer(live: LiveSession) {
  if (live.idleTimer) clearTimeout(live.idleTimer)
  live.idleTimer = setTimeout(() => {
    // 闲置到点就收掉子进程。下次发言会重新起一个（靠 resume 接上下文）。
    dropSession(live.sessionId)
  }, IDLE_TTL_MS)
  // 别让这个定时器拖住 node 退出
  if (typeof live.idleTimer === 'object' && 'unref' in live.idleTimer) {
    ;(live.idleTimer as unknown as { unref: () => void }).unref()
  }
}

export function dropSession(sessionId: string) {
  const live = registry.get(sessionId)
  if (!live) return
  registry.delete(sessionId)
  if (live.idleTimer) clearTimeout(live.idleTimer)
  try {
    live.close()
  } catch {
    /* 关闭队列失败无所谓，进程随后自己退 */
  }
  try {
    void live.q.interrupt?.()
  } catch {
    /* 同上 */
  }
}

export type EnsureSessionInput = {
  sessionId: string
  /** query() 的 options，只在**新建**会话时生效（已有会话沿用建它时的配置） */
  buildOptions: (resumeFrom: string | null) => Options
}

/** 拿到（或新建）一个活着的会话。已有的直接复用，不重付缓存。 */
export function ensureSession(input: EnsureSessionInput): LiveSession {
  const existing = registry.get(input.sessionId)
  if (existing) {
    existing.lastActiveAt = Date.now()
    armIdleTimer(existing)
    return existing
  }

  const queue = createMessageQueue()
  // 上一轮同名会话被回收时记下的 claude code session id，用它 resume 接回上下文
  const resumeFrom = resumeHints.get(input.sessionId) || null
  const q = query({ prompt: queue.iterable, options: input.buildOptions(resumeFrom) })

  const live: LiveSession = {
    sessionId: input.sessionId,
    q,
    push: queue.push,
    close: queue.close,
    iterator: q[Symbol.asyncIterator]() as AsyncIterator<SDKMessage>,
    ccSessionId: '',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    totalCostUsd: 0,
    turnCount: 0,
    lastModelCallAt: 0,
    busy: false,
    idleTimer: null,
  }
  registry.set(input.sessionId, live)
  armIdleTimer(live)
  return live
}

/** 会话被回收后，记住 claude code 的 session id，下次好 resume 接上。 */
const RESUME_KEY = '__ob2_cc_resume__'
const resumeHints: Map<string, string> =
  (globalThis as unknown as Record<string, Map<string, string>>)[RESUME_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, string>>)[RESUME_KEY] = new Map())

export function rememberResumePoint(sessionId: string, ccSessionId: string) {
  if (ccSessionId) resumeHints.set(sessionId, ccSessionId)
}

/** 界面顶部要显示的会话状态。 */
export type SessionStats = {
  live: boolean
  turnCount: number
  totalCostUsd: number
  /** prompt cache 还剩多少毫秒有效（<=0 表示已过期，下一句要重付全款） */
  cacheRemainingMs: number
  ccSessionId: string
  startedAt: number | null
}

export function getSessionStats(sessionId: string): SessionStats {
  const live = registry.get(sessionId)
  if (!live) {
    return {
      live: false,
      turnCount: 0,
      totalCostUsd: 0,
      cacheRemainingMs: 0,
      ccSessionId: resumeHints.get(sessionId) || '',
      startedAt: null,
    }
  }
  const remaining = live.lastModelCallAt
    ? Math.max(0, PROMPT_CACHE_TTL_MS - (Date.now() - live.lastModelCallAt))
    : 0
  return {
    live: true,
    turnCount: live.turnCount,
    totalCostUsd: live.totalCostUsd,
    cacheRemainingMs: remaining,
    ccSessionId: live.ccSessionId,
    startedAt: live.createdAt,
  }
}

export type { LiveSession }
