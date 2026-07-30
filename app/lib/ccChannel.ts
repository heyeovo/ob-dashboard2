// 当轮通道 + 待批准队列 + 工作台状态（服务端专用，进程内单例）。
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
//
// 为什么要单独一层，而不是像第 4 步那样写在 buildOptions 的闭包里：
//
//  1. buildOptions **只在会话第一轮**跑一次 —— ccSession.ts 里已有会话就直接复用，
//     不再调它。所以闭包捕获的 `send` 是第一轮那个流的，第 2 轮起推进去的事件
//     全部落进一个已经关掉的流（4.5b 那个「召回信息第二轮不刷新、raw.recall 是空的」
//     就是这个原因）。send 放这里，每轮开头挂上、结尾摘掉，hook / canUseTool 现取。
//
//  2. 待批准的操作不能只活在 SSE 流里。手机上一滑走、页面一刷新就找不回来了，
//     而那一轮还在服务端挂着等答复。队列存这里，前端随时能重新拉一份。
//
// ⚠️ 进程内内存，dev 热重载会丢 —— 挂 globalThis 是为了少丢一点，不是持久化。
// 真正要留住的东西（改过哪些文件、命令输出）每轮一起写进 Haven 的 raw_json。

/**
 * 批准请求挂多久算没人管。
 *
 * 30 分钟 —— 手机上收到、走开一会儿、回来再点，这个来回要留够。
 * 超时按拒绝处理并告诉模型「没人批准」，不能无限挂着：子进程会一直占着。
 */
export const PERM_TTL_MS = 30 * 60 * 1000

/** 命令输出留多少字。build 报错动辄上万字，全存会把 Haven 那一行撑爆。 */
export const CMD_OUTPUT_LIMIT = 4000

export type CcSend = (event: string, data: unknown) => void

/** 批准卡片按哪种样子渲染 */
export type CcPermKind = 'edit' | 'write' | 'bash' | 'web' | 'other'

export type CcDiffLine = { tag: ' ' | '-' | '+'; text: string; n?: number }

export type CcDiffPreview = {
  path: string
  lines: CcDiffLine[]
  added: number
  removed: number
  /** 行数太多截断过 */
  truncated: boolean
  /** 「新建文件」「读不到原文，只比对替换的那一段」这类说明 */
  note: string
}

/** 一条待批准的操作。前端直接渲染这个对象，不用再去猜工具参数长什么样。 */
export type CcPermRequest = {
  /** SDK 那边的 requestId，答复时原样带回来 */
  id: string
  sessionId: string
  toolName: string
  kind: CcPermKind
  /** SDK 渲染好的一句话（"Claude wants to..."），没有就自己拼 */
  title: string
  description: string
  filePath: string
  command: string
  diff: CcDiffPreview | null
  /** SDK 给出的细粒度权限建议；用于“本次对话 / 始终允许”，不自行猜规则。 */
  suggestions: PermissionUpdate[]
  createdAt: number
  expiresAt: number
}

/** 答复。deny 一定要给句话，模型看得到。 */
export type CcPermDecision = PermissionResult

/** 已经决定过的，工作台里留个尾巴（省得点完就消失，不知道刚才批了什么） */
export type CcPermDecided = {
  id: string
  toolName: string
  kind: CcPermKind
  title: string
  filePath: string
  command: string
  /** allow | deny | expired | cancelled */
  outcome: string
  at: number
}

export type CcFileChange = {
  path: string
  tool: string
  added: number
  removed: number
  /** 同一个文件改了几次 */
  count: number
  at: number
}

export type CcCommandRun = {
  id: string
  command: string
  output: string
  at: number
  truncated: boolean
  failed: boolean
}

/** 回退点 = 某条用户消息的 uuid。只有子进程还活着时才能真的回退。 */
export type CcCheckpoint = { uuid: string; label: string; at: number }

/** 一个会话在服务端的「现在」。工作台四格全从这里出。 */
type Channel = {
  sessionId: string
  /** 当前那一轮的 SSE 推送口。没人在听就是 null（页面关了 / 上一轮结束了） */
  send: CcSend | null
  /** 待批准队列，先进先出 */
  pending: CcPermRequest[]
  /** id → resolve。canUseTool 停在这个 promise 上 */
  waiters: Map<string, (d: CcPermDecision) => void>
  timers: Map<string, ReturnType<typeof setTimeout>>
  decided: CcPermDecided[]
  files: CcFileChange[]
  commands: CcCommandRun[]
  checkpoints: CcCheckpoint[]
  /**
   * 「这个会话内 Edit / Write 都放行」。
   *
   * ⚠️ 只覆盖 Edit / Write，**Bash 永远一条一条问**（用户拍板）。
   * 用我们自己这个开关而不是 SDK 的 updatedPermissions，是为了随时能关掉、
   * 而且不会写进任何 settings 文件影响别的会话。
   */
  autoAllowEdits: boolean
}

// dev 热重载会重新求值模块，挂 globalThis 才不会每改一行代码就把待批准的东西丢掉
const CHANNEL_KEY = '__ob2_cc_channels__'
type ChannelStore = Map<string, Channel>
const globalStore = globalThis as unknown as Record<string, ChannelStore>
const channels: ChannelStore = globalStore[CHANNEL_KEY] || (globalStore[CHANNEL_KEY] = new Map())

function blank(sessionId: string): Channel {
  return {
    sessionId,
    send: null,
    pending: [],
    waiters: new Map(),
    timers: new Map(),
    decided: [],
    files: [],
    commands: [],
    checkpoints: [],
    autoAllowEdits: false,
  }
}

export function getChannel(sessionId: string): Channel {
  let ch = channels.get(sessionId)
  if (!ch) {
    ch = blank(sessionId)
    channels.set(sessionId, ch)
  }
  return ch
}

/** 只看有没有，不新建（GET 状态时用，别因为查一下就建一堆空壳） */
export function peekChannel(sessionId: string): Channel | null {
  return channels.get(sessionId) || null
}

/** 这一轮开始：把 SSE 推送口挂上。上一轮的自动作废。 */
export function attachSend(sessionId: string, send: CcSend) {
  getChannel(sessionId).send = send
}

/** 这一轮结束：摘掉推送口。待批准的东西不动 —— 它们比一轮活得长。 */
export function detachSend(sessionId: string, send: CcSend) {
  const ch = channels.get(sessionId)
  if (ch && ch.send === send) ch.send = null
}

/** 往当前那一轮的流里推。没人在听就静默丢掉（状态另有 GET 接口能拉）。 */
export function emit(sessionId: string, event: string, data: unknown) {
  const ch = channels.get(sessionId)
  ch?.send?.(event, data)
}

/* ────────────────── 待批准队列 ────────────────── */

/** 决定结果记进尾巴，只留最近 30 条 */
function pushDecided(ch: Channel, req: CcPermRequest, outcome: string) {
  ch.decided.unshift({
    id: req.id,
    toolName: req.toolName,
    kind: req.kind,
    title: req.title,
    filePath: req.filePath,
    command: req.command,
    outcome,
    at: Date.now(),
  })
  ch.decided.length = Math.min(ch.decided.length, 30)
}

function settle(ch: Channel, id: string, decision: CcPermDecision, outcome: string) {
  const timer = ch.timers.get(id)
  if (timer) {
    clearTimeout(timer)
    ch.timers.delete(id)
  }
  const idx = ch.pending.findIndex(p => p.id === id)
  if (idx >= 0) {
    pushDecided(ch, ch.pending[idx], outcome)
    ch.pending.splice(idx, 1)
  }
  const waiter = ch.waiters.get(id)
  ch.waiters.delete(id)
  waiter?.(decision)
  // 前端两处都要更新：对话流里那张卡片、工作台那一格
  ch.send?.('permission_resolved', { id, outcome })
}

/**
 * 挂一条批准请求，停在这里等答复。canUseTool 直接 await 这个函数。
 *
 * 三种收场，都会走到 settle：
 *   点了按钮   → POST /api/cc-permission
 *   30 分钟没点 → 超时，按拒绝，告诉模型没人批准
 *   会话被收掉 → cancelAllPending，按拒绝
 */
export function requestPermission(
  sessionId: string,
  req: Omit<CcPermRequest, 'sessionId' | 'createdAt' | 'expiresAt'>,
): Promise<CcPermDecision> {
  const ch = getChannel(sessionId)
  const now = Date.now()
  const full: CcPermRequest = {
    ...req,
    sessionId,
    createdAt: now,
    expiresAt: now + PERM_TTL_MS,
  }
  ch.pending.push(full)
  // 对话流里当场弹卡片。页面没开着也没关系 —— 它还在 pending 里，GET 能拉回来。
  ch.send?.('permission', full)

  return new Promise<CcPermDecision>(resolve => {
    ch.waiters.set(full.id, resolve)
    const timer = setTimeout(() => {
      settle(
        ch,
        full.id,
        {
          behavior: 'deny',
          message:
            '这个操作等了 30 分钟没人批准，自动取消了 —— 它没有被执行，' +
            '命令没跑，文件没改，回复里别说它做完了。别重试同一个操作，' +
            '先把你想做什么和为什么说清楚，等人回来再说。',
        },
        'expired',
      )
    }, PERM_TTL_MS)
    if (typeof timer === 'object' && 'unref' in timer) {
      ;(timer as unknown as { unref: () => void }).unref()
    }
    ch.timers.set(full.id, timer)
  })
}

/** 前端点了按钮。返回 false = 这条已经不在队列里了（超时了 / 点重了）。 */
export function answerPermission(
  sessionId: string,
  id: string,
  decision: CcPermDecision,
): boolean {
  const ch = channels.get(sessionId)
  if (!ch || !ch.waiters.has(id)) return false
  settle(ch, id, decision, decision.behavior)
  return true
}

export function pendingPermission(sessionId: string, id: string): CcPermRequest | null {
  return channels.get(sessionId)?.pending.find(item => item.id === id) || null
}

/** 会话要被收掉了：挂着的全部拒掉，不然那些 promise 永远不 resolve。 */
export function cancelAllPending(sessionId: string, reason: string) {
  const ch = channels.get(sessionId)
  if (!ch) return
  for (const req of [...ch.pending]) {
    settle(ch, req.id, { behavior: 'deny', message: reason }, 'cancelled')
  }
}

export function hasPending(sessionId: string): boolean {
  const ch = channels.get(sessionId)
  return !!ch && ch.pending.length > 0
}

export function setAutoAllowEdits(sessionId: string, on: boolean) {
  getChannel(sessionId).autoAllowEdits = on
}

export function autoAllowEdits(sessionId: string): boolean {
  return channels.get(sessionId)?.autoAllowEdits === true
}

/* ────────────────── 工作台的另外三格 ────────────────── */

/** 记一次文件改动。同一个文件重复改就并成一条，增删行数累加。 */
export function recordFileChange(
  sessionId: string,
  change: { path: string; tool: string; added: number; removed: number },
) {
  const ch = getChannel(sessionId)
  const hit = ch.files.find(f => f.path === change.path)
  if (hit) {
    hit.added += change.added
    hit.removed += change.removed
    hit.count += 1
    hit.at = Date.now()
    hit.tool = change.tool
  } else {
    ch.files.push({ ...change, count: 1, at: Date.now() })
  }
  ch.send?.('files', { files: ch.files })
}

export function recordCommand(
  sessionId: string,
  run: { id: string; command: string; output: string; failed: boolean },
) {
  const ch = getChannel(sessionId)
  const truncated = run.output.length > CMD_OUTPUT_LIMIT
  ch.commands.unshift({
    id: run.id,
    command: run.command,
    // 截尾巴留头 —— 报错信息一般在前面
    output: truncated ? `${run.output.slice(0, CMD_OUTPUT_LIMIT)}\n… 输出太长，后面截掉了` : run.output,
    at: Date.now(),
    truncated,
    failed: run.failed,
  })
  ch.commands.length = Math.min(ch.commands.length, 20)
  ch.send?.('command', ch.commands[0])
}

/**
 * 记一个回退点。
 *
 * ⚠️ 只有子进程还活着时才真的能回退（rewindFiles 走的是子进程里的备份）。
 * 闲置回收之后这些点就失效了，工作台那一格会照实说。
 */
export function recordCheckpoint(sessionId: string, uuid: string, label: string) {
  const ch = getChannel(sessionId)
  if (!uuid || ch.checkpoints.some(c => c.uuid === uuid)) return
  ch.checkpoints.unshift({ uuid, label: label.slice(0, 60), at: Date.now() })
  ch.checkpoints.length = Math.min(ch.checkpoints.length, 20)
}

/** 这一轮记下来的东西，写 Haven 的 raw_json 用。进程没了以后靠它重建。 */
export function turnSnapshot(sessionId: string): {
  files: CcFileChange[]
  commands: CcCommandRun[]
  decided: CcPermDecided[]
} {
  const ch = channels.get(sessionId)
  if (!ch) return { files: [], commands: [], decided: [] }
  return { files: ch.files, commands: ch.commands, decided: ch.decided }
}

/** 工作台 GET 要的那一份。 */
export type CcWorkbenchState = {
  pending: CcPermRequest[]
  decided: CcPermDecided[]
  files: CcFileChange[]
  commands: CcCommandRun[]
  checkpoints: CcCheckpoint[]
  autoAllowEdits: boolean
}

export function workbenchState(sessionId: string): CcWorkbenchState {
  const ch = channels.get(sessionId)
  if (!ch) {
    return {
      pending: [],
      decided: [],
      files: [],
      commands: [],
      checkpoints: [],
      autoAllowEdits: false,
    }
  }
  return {
    pending: ch.pending,
    decided: ch.decided,
    files: ch.files,
    commands: ch.commands,
    checkpoints: ch.checkpoints,
    autoAllowEdits: ch.autoAllowEdits,
  }
}

/** 会话重开 / 换会话：把这一份状态清空（挂着的先拒掉）。 */
export function resetChannel(sessionId: string, reason: string) {
  cancelAllPending(sessionId, reason)
  const ch = channels.get(sessionId)
  if (!ch) return
  ch.files = []
  ch.commands = []
  ch.checkpoints = []
  ch.decided = []
  ch.autoAllowEdits = false
}
