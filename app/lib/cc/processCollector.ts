// 一轮对话的「过程收集器」：thinking / 助手文字 / 工具按实际发生顺序
// 攒进这一轮的 process 数组（第 7 步建，9.5 从 route.ts 原样抽出）。
//
// ⚠️ 为什么桶要放在模块级 Map 而不是跟着 runTurn 的局部变量走：
// hooks 的闭包只在会话**第一轮**建起来（ccSession 里已有会话就复用），
// 要拿到第 N 轮的 process / webSearchCount 就得每轮按 sessionId 重查。
// 这也意味着：一轮结束必须 delete 掉自己的桶，不然下一轮会跟旧数据叠一起。
//
// 收集器只负责「攒」，不负责「展示」—— 攒出来的数组写进 raw_json.process，
// 前端历史读回后按原顺序展示。

import { emit } from '@/app/lib/ccChannel'
import { randomUUID } from 'node:crypto'

export type RoomVisit = {
  id: string; room_id: string; session_id: string; request_id: string
  turn_kind: 'chat' | 'agent_wake'; entered_at: string; left_at: string
  duration_ms: number; process: Array<Record<string, unknown>>
}

export function newRoomState() {
  return { active: false, id: '', roomId: '', roomTitle: '', enteredAt: 0, lockUntil: '',
    process: [] as Array<Record<string, unknown>>, toolEvents: [] as Array<Record<string, unknown>>,
    visits: [] as RoomVisit[] }
}

/** 这一轮的收集口。hook 和 canUseTool 都从桶里拿，不捕获局部变量。 */
export type TurnBucket = {
  recallInfo: Record<string, unknown> | null
  toolEvents: Array<Record<string, unknown>>
  processEvents: Array<Record<string, unknown>>
  webSearchCount: number
  webFetchCount: number
  toolCallCount: number
  room: ReturnType<typeof newRoomState>
}

export function newTurnBucket(): TurnBucket {
  return {
    recallInfo: null,
    toolEvents: [],
    processEvents: [],
    webSearchCount: 0,
    webFetchCount: 0,
    toolCallCount: 0,
    room: newRoomState(),
  }
}

/** 这个会话「当前那一轮」的桶。 */
const turnBuckets = new Map<string, TurnBucket>()

export function setTurnBucket(sessionId: string, bucket: TurnBucket) {
  turnBuckets.set(sessionId, bucket)
}

export function getTurnBucket(sessionId: string): TurnBucket | null {
  return turnBuckets.get(sessionId) || null
}

/** 只删自己那份：收尾这一秒里可能已经有新的一轮把它换掉了 */
export function deleteTurnBucket(sessionId: string, bucket: TurnBucket) {
  if (turnBuckets.get(sessionId) === bucket) turnBuckets.delete(sessionId)
}

/** 会话被收掉时无条件清掉残留桶（DELETE 路由用；正常收尾走 deleteTurnBucket）。 */
export function clearTurnBucket(sessionId: string) {
  turnBuckets.delete(sessionId)
}

/** 工具记录加一条，同时推给前端。hook 里必须用这个，不能碰局部变量。 */
export function pushToolEvent(sessionId: string, item: Record<string, unknown>) {
  const bucket = turnBuckets.get(sessionId)
  if (bucket?.room.active) {
    bucket.room.toolEvents.push(item)
    bucket.room.process.push({ type: 'tool', id: `process-${String(item.id || Date.now())}`, tool: item })
    return
  }
  if (bucket) {
    closeThinkingProcess(bucket, Date.now())
    bucket.toolEvents.push(item)
    bucket.processEvents.push({
      type: 'tool',
      id: `process-${String(item.id || Date.now())}`,
      tool: item,
    })
  }
  emit(sessionId, 'tool', item)
}

export function closeThinkingProcess(bucket: TurnBucket, endedAt: number) {
  const last = (bucket.room.active ? bucket.room.process : bucket.processEvents).at(-1)
  if (!last || last.type !== 'thinking' || typeof last.durationMs === 'number') return
  last.durationMs = Math.max(0, endedAt - Number(last.startedAt || endedAt))
}

export function appendThinkingProcess(
  bucket: TurnBucket,
  text: string,
): { id: string; startedAt: number } {
  const events = bucket.room.active ? bucket.room.process : bucket.processEvents
  const last = events.at(-1)
  if (last?.type === 'thinking' && typeof last.durationMs !== 'number') {
    last.text = String(last.text || '') + text
    return {
      id: String(last.id),
      startedAt: Number(last.startedAt || Date.now()),
    }
  }

  const startedAt = Date.now()
  const item = {
    type: 'thinking',
    id: `thinking-${startedAt}-${bucket.processEvents.length}`,
    text,
    startedAt,
  }
  events.push(item)
  return { id: item.id, startedAt }
}

export function appendTextProcess(bucket: TurnBucket, text: string): { id: string } {
  const events = bucket.room.active ? bucket.room.process : bucket.processEvents
  const last = events.at(-1)
  if (last?.type === 'text') {
    last.text = String(last.text || '') + text
    return { id: String(last.id) }
  }

  const item = {
    type: 'text',
    id: `text-${Date.now()}-${bucket.processEvents.length}`,
    text,
  }
  events.push(item)
  return { id: item.id }
}

export function enterRoom(bucket: TurnBucket, input: Record<string, unknown>, adjacentThinkingId?: string) {
  const room = bucket.room
  room.active = true
  room.id = `visit-${randomUUID()}`
  room.enteredAt = Date.now()
  room.roomId = String(input.room_id || '')
  room.roomTitle = String(input.title || '')
  room.lockUntil = ''
  room.process = []
  room.toolEvents = []
  const last = bucket.processEvents.at(-1)
  const retractIds: string[] = []
  let retractedText = ''
  if (last?.type === 'thinking' && last.id === adjacentThinkingId) {
    bucket.processEvents.pop()
    room.process.push(last)
    retractIds.push(String(last.id))
    retractedText = String(last.text || '')
  }
  return { id: room.id, enteredAt: room.enteredAt, retractIds, retractedText }
}

export function leaveRoom(bucket: TurnBucket, sessionId: string, requestId: string, turnKind: 'chat' | 'agent_wake') {
  const room = bucket.room
  if (!room.active) return null
  closeThinkingProcess(bucket, Date.now())
  room.active = false
  const leftAt = Date.now()
  const event = { type: 'room' as const, id: room.id, roomId: room.roomId, roomTitle: room.roomTitle,
    enteredAt: room.enteredAt, leftAt, durationMs: Math.max(0, leftAt - room.enteredAt),
    lockUntil: room.lockUntil || undefined }
  bucket.processEvents.push(event)
  room.visits.push({ id: room.id, room_id: room.roomId, session_id: sessionId, request_id: requestId,
    turn_kind: turnKind, entered_at: new Date(room.enteredAt).toISOString(), left_at: new Date(leftAt).toISOString(),
    duration_ms: event.durationMs, process: room.process })
  return event
}
