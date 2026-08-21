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

import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type Options,
} from '@anthropic-ai/claude-agent-sdk'
import { cancelAllPending, hasPending } from './ccChannel'
import type { CcMcpApplySummary } from './ccMcpTypes'
import type { CredMode } from './ccEnv'

/** 闲置多久回收子进程。跟 prompt cache 的 5 分钟没关系，纯粹是别让子进程无限堆着。 */
const IDLE_TTL_MS = 10 * 60 * 1000

/**
 * prompt cache 分两档，不是一刀切 5 分钟（5.2 修正）。
 *
 * 实测返回里两个数字是分开的：
 *   cache_creation: { ephemeral_1h_input_tokens: 8837, ephemeral_5m_input_tokens: 11546 }
 *
 * cc 自己在分配：最稳定的那部分（系统提示 + 工具定义）进 1h 档，
 * 会话消息进 5m 档。所以 5 分钟一过**不是「缓存没了」** —— 那几万字系统提示
 * 还活着，接着聊仍然便宜。以前按 5 分钟一刀切显示，比真实情况悲观，会催着人赶紧说话。
 *
 * ⚠️ 哪部分内容进哪档我们说不上话（SDK 没暴露这个开关），只能照实显示分了多少。
 */
export const CACHE_TTL_SYSTEM_MS = 60 * 60 * 1000
export const CACHE_TTL_SESSION_MS = 5 * 60 * 1000

/** 一轮的用量。每条消息右下角那个 token 面板要的就是这些。 */
export type TurnUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 1h 档写了多少（cache_creation.ephemeral_1h_input_tokens） */
  cacheWrite1hTokens: number
  /** 5m 档写了多少 */
  cacheWrite5mTokens: number
  durationMs: number
  /** 输出速度，output / 秒 */
  tokensPerSec: number
  costUsd: number
}

export const EMPTY_TURN_USAGE: TurnUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  cacheWrite5mTokens: 0,
  durationMs: 0,
  tokensPerSec: 0,
  costUsd: 0,
}

/**
 * 这个会话启动时定死的那些参数。
 *
 * ⚠️ 为什么要记下来：`systemPrompt` / `tools` / `env`（= 凭据和中转站地址）
 * 都是子进程 spawn 时定的，中途改不了。界面上「本窗口设置」要照实显示
 * 现在跑的是哪一套，就得有个地方存 —— 不能拿前端最新的选择去显示，
 * 那会显示成用户刚点的、而不是实际在跑的。
 *
 * 能中途改的只有 model / effort / thinking（SDK 的 setModel、setMaxThinkingTokens）。
 */
export type SessionBoot = {
  /** chat = 闲聊模式（不带 preset、零工具），work = 工作模式（preset + 7 个工具） */
  mode: 'chat' | 'work'
  /** subscription | api */
  credKind: CredMode
  /** 哪个中转站（api 时有值），显示用 */
  providerId: string
  providerLabel: string
}

/** 一个会话在服务端的活体状态。 */
type LiveSession = {
  sessionId: string
  /** Pro / API provider 各自独立的 Claude 原生 session 键。 */
  resumeKey: string
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
  /** 协作者身份与提示词模块的组合指纹；变化时重建 query，handoff 不参与。 */
  systemPromptKey: string
  turnCount: number
  /** 最后一次真正打到模型的时间，用来算 prompt cache 还有多久过期 */
  lastModelCallAt: number
  /** 启动时定死的那几项（模式 / 凭据 / 中转站），界面照实显示用 */
  boot: SessionBoot
  /** 现在跑的模型名。setModel 换过就跟着变，所以不能只看 boot */
  model: string
  /** 现在的 effort */
  effort: string
  /** thinking 开着吗 */
  thinking: boolean
  /** 近 10 轮的花费，「本窗口设置」里显示。进程被回收就没了（内存态） */
  recentCostUsd: number[]
  /** 上下文用量，getContextUsage() 拉回来缓存一份 */
  contextTokens: number
  contextMaxTokens: number
  /** 正在跑一轮吗 —— 同一个会话不允许并发发言（一个 iterator 只能一个消费者） */
  busy: boolean
  /** 保存 MCP 时若这轮还在生成，结果边界一到回收 query，下一句话用新前缀 resume。 */
  pendingMcpRestart: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
}

// dev 模式下 Next 会热重载模块，挂在 globalThis 上才不会每次改代码就丢掉所有会话
const REGISTRY_KEY = '__ob2_cc_sessions__'
type Registry = Map<string, LiveSession>
const registry: Registry =
  (globalThis as unknown as Record<string, Registry>)[REGISTRY_KEY] ||
  ((globalThis as unknown as Record<string, Registry>)[REGISTRY_KEY] = new Map())

export type CcProUsageSnapshot = {
  available: boolean
  stale: boolean
  experimental: true
  subscriptionType: string
  fiveHour: { utilization: number | null; resetsAt: string | null } | null
  sevenDay: { utilization: number | null; resetsAt: string | null } | null
  updatedAt: string
  note: string
}

const PRO_USAGE_KEY = '__ob2_cc_pro_usage__'
const proUsageBySession: Map<string, CcProUsageSnapshot> =
  (globalThis as unknown as Record<string, Map<string, CcProUsageSnapshot>>)[PRO_USAGE_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, CcProUsageSnapshot>>)[PRO_USAGE_KEY] = new Map())

export async function getProUsage(sessionId: string): Promise<CcProUsageSnapshot> {
  const live = registry.get(sessionId)
  const cached = proUsageBySession.get(sessionId)
  if (!live || live.boot.credKind !== 'subscription') {
    return cached
      ? { ...cached, stale: true, note: '当前不是在线 Pro 线路，显示上次读取值' }
      : {
          available: false,
          stale: true,
          experimental: true,
          subscriptionType: '',
          fiveHour: null,
          sevenDay: null,
          updatedAt: '',
          note: '使用 Pro 线路完成一轮后可读取额度',
        }
  }
  if (live.busy) {
    return cached
      ? { ...cached, stale: true, note: 'Pro 正在回复，显示上次读取值' }
      : {
          available: false,
          stale: true,
          experimental: true,
          subscriptionType: 'pro',
          fiveHour: null,
          sevenDay: null,
          updatedAt: '',
          note: 'Pro 正在回复，完成后再读取额度',
        }
  }
  let usageTimer: ReturnType<typeof setTimeout> | null = null
  try {
    const usage = await Promise.race([
      live.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      new Promise<never>((_, reject) => {
        usageTimer = setTimeout(() => reject(new Error('usage timeout')), 5_000)
      }),
    ])
    const limits = usage.rate_limits
    const snapshot: CcProUsageSnapshot = {
      available: usage.rate_limits_available && !!limits,
      stale: false,
      experimental: true,
      subscriptionType: String(usage.subscription_type || ''),
      fiveHour: limits?.five_hour
        ? { utilization: limits.five_hour.utilization, resetsAt: limits.five_hour.resets_at }
        : null,
      sevenDay: limits?.seven_day
        ? { utilization: limits.seven_day.utilization, resetsAt: limits.seven_day.resets_at }
        : null,
      updatedAt: new Date().toISOString(),
      note: usage.rate_limits_available ? '' : '当前 SDK session 没有可用的订阅额度数据',
    }
    proUsageBySession.set(sessionId, snapshot)
    return snapshot
  } catch {
    return cached
      ? { ...cached, stale: true, note: '额度读取暂时失败，显示上次读取值' }
      : {
          available: false,
          stale: true,
          experimental: true,
          subscriptionType: '',
          fiveHour: null,
          sevenDay: null,
          updatedAt: '',
          note: '实验性额度接口当前不可用',
        }
  } finally {
    if (usageTimer) clearTimeout(usageTimer)
  }
}

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
    // ⚠️ 有操作还挂着等批准就不能收 —— 那一轮正停在 canUseTool 上等人点按钮，
    // 而批准的等待窗口（30 分钟）比这个闲置时限（10 分钟）长。收掉子进程等于
    // 「你去泡杯茶回来，要批准的东西没了，那一轮也白跑了」。往后顺延接着等。
    if (hasPending(live.sessionId)) {
      armIdleTimer(live)
      return
    }
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
  // 挂着等批准的先全拒掉，不然那些 await 永远不返回，子进程也退不干净
  cancelAllPending(sessionId, '会话已经结束了，这个操作取消。')
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

/* ── 用户点「停止」：优雅中断，而不是断开重来 ── */

/** 这一轮被用户点了「停止」（/api/cc-stop 时标记，POST 循环读它做优雅收尾）。 */
const interruptedTurns = new Set<string>()

/** /api/cc-stop：标记当前这一轮被中断。 */
export function markTurnInterrupted(sessionId: string) {
  interruptedTurns.add(sessionId)
}

/** POST 循环：消费「这一轮被中断」标记，读完就删。 */
export function consumeTurnInterrupted(sessionId: string): boolean {
  return interruptedTurns.delete(sessionId)
}

/** 每一轮开始前清掉残留标记 —— 上一轮中断时若已过消费点，这里防止它污染这一轮。 */
export function clearTurnInterrupted(sessionId: string) {
  interruptedTurns.delete(sessionId)
}

/**
 * 点「停止」时调用：让当前这一轮优雅收尾，而不是像以前那样断开 SSE、把半截回复整个丢掉。
 *
 * 调 q.interrupt() 把模型叫停 —— 这是控制请求，**不杀子进程**。已生成的字会继续以
 * aborted 标记的 assistant 消息流回 POST 循环，会话上下文保留，下一句继续聊模型记得
 * 这条半截回复（跟官方 CLI 按 Esc 一个效果）。
 *
 * 兜底：interrupt 控制请求 15 秒没回来说明子进程卡死，直接收掉进程 ——
 * 宁可丢这一轮，也不能让界面永远停在「停止中」。
 */
export async function stopSession(sessionId: string): Promise<void> {
  const live = registry.get(sessionId)
  if (!live || !live.busy) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ok = await Promise.race([
      live.q.interrupt().then(() => true, () => false),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), 15_000)
      }),
    ])
    if (!ok) dropSession(sessionId)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type EnsureSessionInput = {
  sessionId: string
  resumeKey?: string
  /** query() 的 options，只在**新建**会话时生效（已有会话沿用建它时的配置） */
  buildOptions: (resumeFrom: string | null) => Options
  /** 启动时定死的那几项，同样只在新建时记下 */
  boot: SessionBoot
  model: string
  effort: string
  thinking: boolean
  systemPromptKey: string
}

/** 拿到（或新建）一个活着的会话。已有的直接复用，不重付缓存。 */
export function ensureSession(input: EnsureSessionInput): LiveSession {
  const resumeKey = input.resumeKey || input.sessionId
  let existing = registry.get(input.sessionId)
  if (existing && existing.resumeKey !== resumeKey && !existing.busy) {
    dropSession(input.sessionId)
    existing = undefined
  }
  if (existing && existing.systemPromptKey !== input.systemPromptKey && !existing.busy) {
    dropSession(input.sessionId)
    existing = undefined
  }
  if (existing) {
    existing.lastActiveAt = Date.now()
    armIdleTimer(existing)
    return existing
  }

  const queue = createMessageQueue()
  // 上一轮同名会话被回收时记下的 claude code session id，用它 resume 接回上下文
  const resumeFrom = resumeHints.get(resumeKey) || null
  const q = query({ prompt: queue.iterable, options: input.buildOptions(resumeFrom) })

  const live: LiveSession = {
    sessionId: input.sessionId,
    resumeKey,
    q,
    push: queue.push,
    close: queue.close,
    iterator: q[Symbol.asyncIterator]() as AsyncIterator<SDKMessage>,
    ccSessionId: '',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    totalCostUsd: 0,
    systemPromptKey: input.systemPromptKey,
    turnCount: 0,
    lastModelCallAt: 0,
    boot: input.boot,
    model: input.model,
    effort: input.effort,
    thinking: input.thinking,
    recentCostUsd: [],
    contextTokens: 0,
    contextMaxTokens: 0,
    busy: false,
    pendingMcpRestart: false,
    idleTimer: null,
  }
  registry.set(input.sessionId, live)
  armIdleTimer(live)
  return live
}

/**
 * 只看一眼，不新建。
 *
 * 工作台的「回退」要用它 —— 回退走的是子进程里的文件备份（rewindFiles），
 * 进程不在了就没得回退，这时候必须能区分「没有这个会话」和「新建一个」，
 * 不能像 ensureSession 那样顺手起一个新进程（那会白付一次缓存，而且备份还是没有）。
 */
export function peekSession(sessionId: string): LiveSession | null {
  return registry.get(sessionId) || null
}

/**
 * MCP 工具集合是 query 启动时写进 prompt 前缀的，单纯 setMcpServers 无法同时
 * 更新 disallowedTools。配置保存后回收空闲 query；下一句话靠 resume 接回原上下文，
 * 并用新的「只含开启工具」前缀重建。正在回答的会话等本轮结果边界再回收。
 */
export async function applyMcpServersToLiveSessions(): Promise<CcMcpApplySummary> {
  const summary: CcMcpApplySummary = { applied: 0, queued: 0, errors: [] }
  for (const live of [...registry.values()]) {
    if (live.busy) {
      live.pendingMcpRestart = true
      summary.queued += 1
      continue
    }
    dropSession(live.sessionId)
    summary.applied += 1
  }
  return summary
}

/** 一轮结束、还没解 busy 锁之前调用；返回 true 表示 query 已回收。 */
export async function flushPendingMcpServers(sessionId: string): Promise<void> {
  const live = registry.get(sessionId)
  if (!live?.pendingMcpRestart) return
  live.pendingMcpRestart = false
  dropSession(sessionId)
}

/** 会话被回收后，记住 claude code 的 session id，下次好 resume 接上。 */
const RESUME_KEY = '__ob2_cc_resume__'
const resumeHints: Map<string, string> =
  (globalThis as unknown as Record<string, Map<string, string>>)[RESUME_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, string>>)[RESUME_KEY] = new Map())

export function rememberResumePoint(resumeKey: string, ccSessionId: string) {
  if (ccSessionId) resumeHints.set(resumeKey, ccSessionId)
}

/** 界面顶部要显示的会话状态。 */
export type SessionStats = {
  live: boolean
  turnCount: number
  totalCostUsd: number
  /**
   * 会话那档缓存（5m）还剩多少毫秒。
   * ⚠️ 别再把它当「缓存没了」—— 系统提示那部分走 1h 档，见下面那个字段。
   */
  cacheRemainingMs: number
  /** 系统提示那档缓存（1h）还剩多少毫秒 */
  cacheSystemRemainingMs: number
  ccSessionId: string
  startedAt: number | null
  /** 启动时定死的那几项。进程不在时是 null */
  boot: SessionBoot | null
  model: string
  effort: string
  thinking: boolean
  /** 近 10 轮花费，新的在后面 */
  recentCostUsd: number[]
  contextTokens: number
  contextMaxTokens: number
}

export const EMPTY_SESSION_STATS: SessionStats = {
  live: false,
  turnCount: 0,
  totalCostUsd: 0,
  cacheRemainingMs: 0,
  cacheSystemRemainingMs: 0,
  ccSessionId: '',
  startedAt: null,
  boot: null,
  model: '',
  effort: '',
  thinking: false,
  recentCostUsd: [],
  contextTokens: 0,
  contextMaxTokens: 0,
}

export function getSessionStats(sessionId: string): SessionStats {
  const live = registry.get(sessionId)
  if (!live) {
    return { ...EMPTY_SESSION_STATS, ccSessionId: resumeHints.get(sessionId) || '' }
  }
  const since = live.lastModelCallAt ? Date.now() - live.lastModelCallAt : 0
  return {
    live: true,
    turnCount: live.turnCount,
    totalCostUsd: live.totalCostUsd,
    cacheRemainingMs: live.lastModelCallAt ? Math.max(0, CACHE_TTL_SESSION_MS - since) : 0,
    cacheSystemRemainingMs: live.lastModelCallAt ? Math.max(0, CACHE_TTL_SYSTEM_MS - since) : 0,
    ccSessionId: live.ccSessionId,
    startedAt: live.createdAt,
    boot: live.boot,
    model: live.model,
    effort: live.effort,
    thinking: live.thinking,
    recentCostUsd: live.recentCostUsd,
    contextTokens: live.contextTokens,
    contextMaxTokens: live.contextMaxTokens,
  }
}

/** 记一轮的花费，只留近 10 轮。 */
export function recordTurnCost(sessionId: string, costUsd: number) {
  const live = registry.get(sessionId)
  if (!live) return
  live.recentCostUsd = [...live.recentCostUsd, Number(costUsd) || 0].slice(-10)
}

/**
 * 中途换模型 / effort / thinking。
 *
 * 能改的只有这三项 —— systemPrompt、tools、凭据（订阅还是哪个中转站）都是
 * 子进程 spawn 时定死的，要换只能新建对话。
 *
 * ⚠️ 换模型会让 prompt cache 整个作废（不同模型不共享缓存，换回来也不恢复），
 * 所以换完那一轮要重付一次缓存写入。界面上得说这句话。
 */
export async function applyRuntimeSettings(
  sessionId: string,
  patch: { model?: string; effort?: string; thinking?: boolean },
): Promise<{ ok: boolean; error: string }> {
  const live = registry.get(sessionId)
  if (!live) return { ok: false, error: '这个对话的进程已经不在了，下一句话会用新设置重开' }
  if (live.busy) return { ok: false, error: '这一轮还没答完，等它结束再换' }

  try {
    if (patch.model !== undefined && patch.model !== live.model) {
      await live.q.setModel(patch.model || undefined)
      live.model = patch.model
      // 换模型 = 缓存作废，缓存倒计时从头开始算才不骗人
      live.lastModelCallAt = 0
    }
    if (patch.effort !== undefined && patch.effort !== live.effort) {
      await live.q.applyFlagSettings({ effortLevel: (patch.effort || null) as never })
      live.effort = patch.effort
    }
    if (patch.thinking !== undefined && patch.thinking !== live.thinking) {
      // 关掉 = 不给 thinking 预算；打开 = 交回模型自己按 effort 决定（传 null 清掉上限）
      await live.q.setMaxThinkingTokens(patch.thinking ? null : 0, patch.thinking ? null : 'omitted')
      live.thinking = patch.thinking
    }
    return { ok: true, error: '' }
  } catch (e) {
    return { ok: false, error: (e as Error).message || '设置没换成功' }
  }
}

/**
 * 记这一轮的上下文用量，给顶部那个「x / 200k」胶囊用。
 *
 * 数字直接从 result 消息的 usage 里加出来：喂进模型的上下文 =
 * 新输入 + 缓存命中 + 这轮新写的缓存。三项互不重叠，加起来就是这一轮的输入总量。
 *
 * ⚠️ 别改回 `q.getContextUsage()`。那条控制请求实测每轮往上游多发 4 个非流请求
 * （按 opus 计费），而且两次分段计时都等满 3s 超时不回 —— 顶部数字一直是旧值。
 * 详见 HANDOFF「一条消息 5 个请求」那节（2026-07-26 已定论）。
 */
export function noteContextUsage(sessionId: string, inputTotal: number, model: string) {
  const live = registry.get(sessionId)
  if (!live) return
  live.contextTokens = Number(inputTotal) || 0
  live.contextMaxTokens = contextLimitFor(model)
}

/**
 * 上下文上限。中转站不报这个值，按模型名认。
 * 认不出来就给 0 —— 前端拿 0 会只显示实际数字、不显示「/ 上限」。
 */
export function contextLimitFor(model: string): number {
  const m = (model || '').toLowerCase()
  if (!m) return 0
  if (m.includes('[1m]')) return 1_000_000
  if (m.includes('haiku')) return 200_000
  if (m.includes('sonnet')) return 200_000
  if (m.includes('opus') || m.includes('fable') || m.includes('mythos')) return 200_000
  return 0
}

export type { LiveSession }
