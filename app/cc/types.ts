// /cc 聊天页的前端类型。故意跟 Haven 的 HavenTurn 分开：
// 界面上一条消息是 user 或 assistant，Haven 存的是「一轮」（user + assistant 一行）。

import type { DisplaySegment } from '@/app/lib/cc/displaySegments'

export type CcRole = 'user' | 'assistant' | 'system'
export type CcEngine = 'cc' | 'selfhost'

export type CcProUsage = {
  available: boolean
  stale: boolean
  experimental: true
  subscriptionType: string
  fiveHour: { utilization: number | null; resetsAt: string | null } | null
  sevenDay: { utilization: number | null; resetsAt: string | null } | null
  updatedAt: string
  note: string
}
export type CcToolStatus = 'running' | 'completed' | 'error' | 'denied'

export type CcDeliveryState =
  | 'generating'
  | 'saving'
  | 'saved'
  | 'replayed'
  | 'not_saved'
  | 'persistence_unknown'
  | 'conflict'
  | 'stopped'

export type CcInterruptedReason = 'user_stop' | 'pro_limit'

export type CcAttachment = {
  id: string
  sessionId: string
  filename: string
  kind: 'image' | 'file'
  mimeType: string
  byteSize: number
  sha256: string
  textChars?: number
  textTruncated?: boolean
  cleared?: boolean
  previewUrl?: string
}

export type CcTurnContext = {
  estimator?: string
  modelContextLimit: number
  replyReserveTokens: number
  inputTokensEstimated: number
  historyTokensEstimated: number
  includedHistoryRounds: number
  omittedHistoryRounds: number
}

export type CcContextSnapshot = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  maxTokens: number
  remainingTokens: number
  percentage: number
  updatedAt: number
  model: string
  source: 'stream' | 'compact'
}

export type CcCacheSnapshot = {
  refreshedAt: number
  systemTtlMs: number
  sessionTtlMs: number
  model: string
}

export type CcCompactionEvent = {
  id: string
  trigger: 'manual' | 'auto'
  preTokens: number
  postTokens: number | null
  durationMs: number | null
  at: number
}

export type CcToolEvent = {
  name: string
  id: string
  input?: unknown
  status?: CcToolStatus
  startedAt?: number
  durationMs?: number
  error?: string
  /** MCP 日常工具会保存输出；Read/Grep/Bash 等工作工具仍然不保存。 */
  result?: string
}

/**
 * 助手正文前的真实过程顺序。
 * 一轮可以是：thinking → tool → thinking → tool；不要再把两类内容拆开后重排。
 */
export type CcProcessEvent =
  | {
      type: 'thinking'
      id: string
      text: string
      startedAt?: number
      durationMs?: number
    }
  | {
      /** 工具调用前后的助手可见文字；最后一段仍作为正式回答显示。 */
      type: 'text'
      id: string
      text: string
    }
  | {
      type: 'tool'
      id: string
      tool: CcToolEvent
    }
  | {
      type: 'compact'
      id: string
      compaction: CcCompactionEvent
    }

/** 一轮的 token 用量。每条助手消息右下角那个小面板要的就是这些。 */
export type CcTurnUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  cacheWrite5mTokens: number
  durationMs: number
  tokensPerSec: number
  costUsd: number
}

export type CcMessage = {
  /** 前端本地 id，不是 Haven 的 turn_id */
  id: string
  role: CcRole
  text: string
  attachments?: CcAttachment[]
  /** 助手侧的 thinking，可折叠 */
  thinking?: string
  /** 思考用了多久（毫秒）。显示成「深度思考 (2.3s)」 */
  thinkingMs?: number
  /** 这一轮的用量（只有助手消息有；老消息没有就是 undefined，不显示） */
  usage?: CcTurnUsage | null
  /** 助手这一轮调过的工具 */
  tools?: CcToolEvent[]
  /** thinking / 助手文字 / 工具按实际发生顺序组成的过程时间线 */
  process?: CcProcessEvent[]
  /** 这一轮召回了什么（只有助手消息有） */
  recall?: CcRecallInfo | null
  /** 正在流式输出中 */
  streaming?: boolean
  /** 这一轮被用户点了「停止」—— 保留已生成的字，显示「已停止」 */
  interrupted?: boolean
  /** 手动停止与 Pro 额度中断要显示不同状态；老历史缺失时按手动停止兼容。 */
  interruptedReason?: CcInterruptedReason
  createdAt: number
  /** 来自 Haven 的历史消息（不可重发/编辑） */
  fromHistory?: boolean
  /** 5.5 换窗带过来的上一窗原文：淡色、只作衔接语境，不可重发 */
  handoff?: boolean
  /**
   * 这一轮是谁回的（协作者 id）。从 Haven 的 client 列解出来（`ob2-chat/<id>`）。
   * 空串 = 4.5b 之前的老消息或 Polaris 写的，退回按当前选中的那个显示。
   */
  personaId?: string
  /** 10.3：这一轮真实走的执行器与上游，不跟当前窗口选择混用。 */
  engine?: CcEngine
  providerId?: string
  providerLabel?: string
  /** CC 的凭据线路；Pro/API Context 不可混用。 */
  laneId?: string
  model?: string
  context?: CcTurnContext | null
  /** 最近一次模型请求的当前窗口快照，不是本轮累计 usage。 */
  contextSnapshot?: CcContextSnapshot | null
  cacheSnapshot?: CcCacheSnapshot | null
  /** 独立系统分隔消息使用。 */
  compaction?: CcCompactionEvent
  /** presentation-only：完整 assistant 原文仍保存在 text。 */
  displaySegments?: DisplaySegment[]
  wakeEvent?: { cause: string; at: string }
  nextWake?: { at: string; reason: string }
  requestId?: string
  roundId?: number
  deliveryState?: CcDeliveryState
  deliveryNote?: string
  /** 保存结果未知时，用同一个 request_id 原位核对/重放。 */
  retryText?: string
  retryExpectedLastRoundId?: number
  retryAttachmentIds?: string[]
}

/**
 * 召回详情弹窗里的一段。key 对应真正走动态召回的两类子系统：
 * memory_card（桶检索）/ date_recall（按日期捞当天原文）。
 * `text` 是服务端从 additional_context 切出来的注入正文（第 6 步接上）。
 */
export type CcRecallModule = {
  key: string
  card_count: number
  chars: number
  text: string
}

export type CcRecallInfo = {
  ok: boolean
  card_count: number
  chars: number
  elapsed_ms: number
  injected: boolean
  domains?: string[]
  error?: string
  /** 分模块明细。服务端暂未提供，弹窗会退化成单段 */
  modules?: CcRecallModule[]
}

/* ────────────── 第 5 步：写权限 / 工作台 ────────────── */

export type CcPermKind = 'edit' | 'write' | 'bash' | 'web' | 'other'

export type CcDiffLine = { tag: ' ' | '-' | '+'; text: string; n?: number }

export type CcDiffPreview = {
  path: string
  lines: CcDiffLine[]
  added: number
  removed: number
  truncated: boolean
  note: string
}

/**
 * 一条等着点批准的操作。服务端把 diff / 命令原文都拼好了，这里只渲染。
 * ⚠️ 它活在服务端队列里，不只活在 SSE 里 —— 页面刷新后靠 GET 重新拉。
 */
export type CcPermRequest = {
  id: string
  sessionId: string
  toolName: string
  kind: CcPermKind
  title: string
  description: string
  filePath: string
  command: string
  diff: CcDiffPreview | null
  suggestions: Array<{
    type: string
    rules?: Array<{ toolName: string; ruleContent?: string }>
    behavior?: string
    destination?: string
  }>
  createdAt: number
  expiresAt: number
}

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

export type CcCheckpoint = { uuid: string; label: string; at: number }

/** 工作台四格的一份快照（GET /api/cc-workbench）。 */
export type CcWorkbench = {
  session_id: string
  /** 子进程还活着吗。false = 回退那一格不可用（备份随进程没了） */
  live: boolean
  pending: CcPermRequest[]
  decided: CcPermDecided[]
  files: CcFileChange[]
  commands: CcCommandRun[]
  checkpoints: CcCheckpoint[]
  auto_allow_edits: boolean
  stats: CcSessionStats
  at: number
}

export const EMPTY_STATS: CcSessionStats = {
  live: false,
  turnCount: 0,
  totalCostUsd: 0,
  cacheRemainingMs: 0,
  cacheSystemRemainingMs: 0,
  cacheRefreshedAt: 0,
  ccSessionId: '',
  startedAt: null,
  boot: null,
  model: '',
  effort: '',
  thinking: false,
  recentCostUsd: [],
  contextTokens: 0,
  contextMaxTokens: 0,
  contextSnapshot: null,
  lastCompaction: null,
  compactionCount: 0,
  compacting: false,
  busy: false,
}

export const EMPTY_WORKBENCH: CcWorkbench = {
  session_id: '',
  live: false,
  pending: [],
  decided: [],
  files: [],
  commands: [],
  checkpoints: [],
  auto_allow_edits: false,
  stats: EMPTY_STATS,
  at: 0,
}

/**
 * 这个会话启动时定死的那几项。
 * ⚠️ 模式 / 凭据 / 中转站都是子进程启动参数，中途改不了 —— 界面照实显示这里的值，
 * 不显示用户刚点的那个（那还没生效）。
 */
export type CcSessionBoot = {
  mode: 'chat' | 'work'
  credKind: string
  providerId: string
  providerLabel: string
}

export type CcSessionStats = {
  live: boolean
  turnCount: number
  totalCostUsd: number
  /** 会话那档缓存（5m）剩多少毫秒 */
  cacheRemainingMs: number
  /** 系统提示那档缓存（1h）剩多少毫秒 */
  cacheSystemRemainingMs: number
  cacheRefreshedAt: number
  ccSessionId: string
  startedAt: number | null
  boot: CcSessionBoot | null
  model: string
  effort: string
  thinking: boolean
  /** 近 10 轮花费，新的在后面 */
  recentCostUsd: number[]
  contextTokens: number
  contextMaxTokens: number
  contextSnapshot: CcContextSnapshot | null
  lastCompaction: CcCompactionEvent | null
  compactionCount: number
  compacting: boolean
  busy: boolean
}

/** 会话列表项。来自 /api/cc-turns（Haven 的 conversation_turns）。 */
export type CcSessionListItem = {
  session_id: string
  persona_id?: string
  turn_count: number
  first_at: string
  last_at: string
  title: string
  model: string
  client: string
  route: string
  source: string
  deleted_at?: string | null
}
