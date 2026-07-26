// /cc 聊天页的前端类型。故意跟 Haven 的 HavenTurn 分开：
// 界面上一条消息是 user 或 assistant，Haven 存的是「一轮」（user + assistant 一行）。

export type CcRole = 'user' | 'assistant'

export type CcToolEvent = {
  name: string
  id: string
  input?: unknown
  /** 工具的输出结果。⚠️ 引擎层还没回传 tool_result，现在恒为空 */
  result?: string
}

export type CcMessage = {
  /** 前端本地 id，不是 Haven 的 turn_id */
  id: string
  role: CcRole
  text: string
  /** 助手侧的 thinking，可折叠 */
  thinking?: string
  /** 助手这一轮调过的工具 */
  tools?: CcToolEvent[]
  /** 这一轮召回了什么（只有助手消息有） */
  recall?: CcRecallInfo | null
  /** 正在流式输出中 */
  streaming?: boolean
  createdAt: number
  /** 来自 Haven 的历史消息（不可重发/编辑） */
  fromHistory?: boolean
  /**
   * 这一轮是谁回的（协作者 id）。从 Haven 的 client 列解出来（`ob2-chat/<id>`）。
   * 空串 = 4.5b 之前的老消息或 Polaris 写的，退回按当前选中的那个显示。
   */
  personaId?: string
}

/**
 * 召回详情弹窗里的一段。key 对应 Haven 那边的子系统
 * （memory_card / date_recall / handoff / cross_window）。
 * ⚠️ `text` 现在恒为空：服务端还没回传注入正文，见 CcRecallDialog 的注释。
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

export type CcPermKind = 'edit' | 'write' | 'bash' | 'other'

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

export const EMPTY_WORKBENCH: CcWorkbench = {
  session_id: '',
  live: false,
  pending: [],
  decided: [],
  files: [],
  commands: [],
  checkpoints: [],
  auto_allow_edits: false,
  stats: {
    live: false,
    turnCount: 0,
    totalCostUsd: 0,
    cacheRemainingMs: 0,
    ccSessionId: '',
    startedAt: null,
  },
  at: 0,
}

export type CcSessionStats = {
  live: boolean
  turnCount: number
  totalCostUsd: number
  cacheRemainingMs: number
  ccSessionId: string
  startedAt: number | null
}

/** 会话列表项。来自 /api/cc-turns（Haven 的 conversation_turns）。 */
export type CcSessionListItem = {
  session_id: string
  turn_count: number
  first_at: string
  last_at: string
  title: string
  model: string
  client: string
  route: string
  source: string
}

export const EMPTY_STATS: CcSessionStats = {
  live: false,
  turnCount: 0,
  totalCostUsd: 0,
  cacheRemainingMs: 0,
  ccSessionId: '',
  startedAt: null,
}
