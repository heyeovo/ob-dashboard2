// cc 引擎前后端的 SSE 事件契约（9.5 步固定下来）。
//
// 事件名保持第 4~7 步既有名字**不变**（前端 useCcChat 的解析依赖它们），
// 这里把每个事件的名字和 payload 类型集中定义：服务端编码用它，
// 前端解码用它，两端不会再各自拼字符串对不上。
//
// 事件的产生方有两处，都在服务端：
//   · runTurn 自己推的（start / init / delta / thinking / recall / tool /
//     tool_result / done / after / error）
//   · ccChannel 推的（permission / permission_resolved / files / command）
//     —— 那一层直接 emit(event, data)，不经 runTurn，所以这里也一并列出。

import type { CcPermRequest } from '@/app/lib/ccChannel'
import type { CcRecallInfo, CcToolEvent, CcTurnUsage } from '@/app/cc/types'
import type { SessionStats } from '@/app/lib/ccSession'

/* ── 事件名 ── */

export const SSE_EVENTS = {
  start: 'start',
  init: 'init',
  delta: 'delta',
  thinking: 'thinking',
  recall: 'recall',
  tool: 'tool',
  toolResult: 'tool_result',
  permission: 'permission',
  permissionResolved: 'permission_resolved',
  done: 'done',
  after: 'after',
  error: 'error',
  files: 'files',
  command: 'command',
} as const

/* ── 每个事件的 payload ── */

export type CcSseStart = { session_id: string; at: number }

export type CcSseInit = {
  claude_code_version?: string
  model?: string
  cwd?: string
  session_id?: string
}

/** 助手正文的增量。id 是服务端 process 段 id，前端靠它判断是不是同一段。 */
export type CcSseDelta = { text: string; id: string }

/** thinking 增量。id / startedAt 同 delta。 */
export type CcSseThinking = { text: string; id: string; startedAt: number }

export type CcSseRecall = CcRecallInfo

export type CcSseTool = CcToolEvent

export type CcSseToolResult = {
  id: string
  result?: string
  error?: string
  status: CcToolEvent['status']
  durationMs: number
}

export type CcSseDone = {
  result: Record<string, unknown> | null
  usage: CcTurnUsage | null
  stats: SessionStats
  elapsed_ms: number
  interrupted?: boolean
}

export type CcSseAfter = {
  store: Record<string, unknown>
  persona: Record<string, unknown>
  stats: SessionStats
  elapsed_ms: number
}

export type CcSseError = { message: string }

export type CcSsePermissionResolved = { id: string; outcome: string }

/** 事件名 → payload 的对照表。send(event, data) 时 type 会互相校验。 */
export type CcSseEventMap = {
  [SSE_EVENTS.start]: CcSseStart
  [SSE_EVENTS.init]: CcSseInit
  [SSE_EVENTS.delta]: CcSseDelta
  [SSE_EVENTS.thinking]: CcSseThinking
  [SSE_EVENTS.recall]: CcSseRecall
  [SSE_EVENTS.tool]: CcSseTool
  [SSE_EVENTS.toolResult]: CcSseToolResult
  [SSE_EVENTS.permission]: CcPermRequest
  [SSE_EVENTS.permissionResolved]: CcSsePermissionResolved
  [SSE_EVENTS.done]: CcSseDone
  [SSE_EVENTS.after]: CcSseAfter
  [SSE_EVENTS.error]: CcSseError
  [SSE_EVENTS.files]: { files: unknown }
  [SSE_EVENTS.command]: unknown
}

export type CcSseEventName = keyof CcSseEventMap
export type CcSsePayload<K extends CcSseEventName> = CcSseEventMap[K]

/* ── 编码（服务端用）── */

/** 一条 SSE 帧。数据必须是可 JSON 序列化的。 */
export function encodeSse<K extends CcSseEventName>(event: K, data: CcSseEventMap[K]): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/* ── 解码（前端用）── */

export type CcSseFrame = { event: string; data: Record<string, unknown> }

/**
 * 从累积缓冲区里切出**第一条**完整帧，返回帧和剩余缓冲区。
 * 帧以空行分界；event 行缺省时按 message 处理；data 行可以多行拼接。
 * 解不出 JSON 时 data 为空对象（事件名仍保留，上层自行处理）。
 */
export function takeSseFrame(buffer: string): { frame: CcSseFrame | null; rest: string } {
  const sep = buffer.indexOf('\n\n')
  if (sep === -1) return { frame: null, rest: buffer }
  const rawFrame = buffer.slice(0, sep)
  const rest = buffer.slice(sep + 2)

  let event = 'message'
  const dataLines: string[] = []
  for (const line of rawFrame.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
  }
  if (dataLines.length === 0) return { frame: { event, data: {} }, rest }

  let data: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(dataLines.join('\n'))
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    /* 解不出 JSON 就按空对象处理 */
  }
  return { frame: { event, data }, rest }
}
