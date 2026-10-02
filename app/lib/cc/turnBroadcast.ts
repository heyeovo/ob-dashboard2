// 可丢失的进程内运行态；最终回复仍只以 Haven 为事实源。
export const TURN_RETENTION_MS = 2 * 60_000
export const TURN_BUFFER_BYTES = 4 * 1024 * 1024
// 防止无人看管的工作轮次无限占用额度。
export const TURN_UNATTENDED_MS = 30 * 60_000

export type TurnEvent = { seq: number; event: string; data: unknown }
type Subscriber = { send: (event: TurnEvent) => void; close: () => void }
export type TurnBroadcast = {
  requestId: string; sessionId: string; userText: string; attachmentIds: string[]; startedAt: number
  events: TurnEvent[]; done: boolean; truncated: boolean; subscribers: Set<Subscriber>
  controller: AbortController; seq: number; bytes: number; executing: boolean
  unattended?: ReturnType<typeof setTimeout>; retention?: ReturnType<typeof setTimeout>
  stop: (reason?: 'unattended') => Promise<void>
}
const key = '__ob2_turn_broadcast_v1'
const root = globalThis as unknown as Record<string, Map<string, TurnBroadcast>>
const turns = root[key] ||= new Map()

function armUnattended(turn: TurnBroadcast) {
  if (turn.done || turn.subscribers.size || turn.unattended) return
  turn.unattended = setTimeout(() => {
    turn.unattended = undefined
    if (!turn.done && !turn.subscribers.size) void turn.stop('unattended').catch(console.error)
  }, TURN_UNATTENDED_MS)
  turn.unattended.unref?.()
}

export function createTurnBroadcast(
  input: Pick<TurnBroadcast, 'requestId' | 'sessionId' | 'userText' | 'attachmentIds' | 'startedAt'>,
  stop: (reason?: 'unattended') => Promise<void>,
): TurnBroadcast | null {
  const previous = turns.get(input.sessionId)
  if (previous && !previous.done) return null
  if (previous?.retention) clearTimeout(previous.retention)
  const turn: TurnBroadcast = {
    ...input, stop, events: [], done: false, truncated: false, subscribers: new Set(),
    controller: new AbortController(), seq: 0, bytes: 0, executing: false,
  }
  turns.set(input.sessionId, turn)
  armUnattended(turn)
  return turn
}

export function getTurnBroadcast(sessionId: string, requestId?: string) {
  const turn = turns.get(sessionId)
  return turn && (!requestId || turn.requestId === requestId) ? turn : undefined
}

export function unfinishedTurns() { return [...turns.values()].filter(turn => !turn.done) }

export function activeTurn(sessionId: string) {
  const turn = turns.get(sessionId)
  return turn && !turn.done ? {
    request_id: turn.requestId, user_text: turn.userText,
    attachment_ids: turn.attachmentIds, started_at: turn.startedAt,
  } : null
}

export function subscribeTurn(turn: TurnBroadcast, subscriber: Subscriber, afterSeq = 0) {
  if (turn.unattended) clearTimeout(turn.unattended)
  turn.unattended = undefined
  const detach = () => { turn.subscribers.delete(subscriber); armUnattended(turn) }
  // 同步重放并登记，期间不会插入另一条 JS 事件。
  try {
    for (const event of turn.events) if (event.seq > afterSeq) subscriber.send(event)
    if (turn.done) subscriber.close()
    else turn.subscribers.add(subscriber)
  } catch { detach() }
  return detach
}

export function publishTurn(turn: TurnBroadcast, event: string, data: unknown) {
  if (turn.done) return
  // 事件必须保存发送时的快照；工具状态会在 runTurn 中继续原地更新。
  const item = { seq: ++turn.seq, event, data: JSON.parse(JSON.stringify(data)) as unknown }
  if (!turn.truncated) {
    turn.bytes += new TextEncoder().encode(encodeTurnEvent(item)).byteLength
    if (turn.bytes > TURN_BUFFER_BYTES) { turn.truncated = true; turn.events = [] }
    else turn.events.push(item)
  }
  for (const subscriber of turn.subscribers) {
    try { subscriber.send(item) } catch { turn.subscribers.delete(subscriber) }
  }
  armUnattended(turn)
}

export function finishTurn(turn: TurnBroadcast) {
  if (turn.done) return
  turn.done = true
  if (turn.unattended) clearTimeout(turn.unattended)
  for (const subscriber of turn.subscribers) { try { subscriber.close() } catch { /* 连接已断 */ } }
  turn.subscribers.clear()
  turn.retention = setTimeout(() => {
    if (turns.get(turn.sessionId) === turn) turns.delete(turn.sessionId)
  }, TURN_RETENTION_MS)
  turn.retention.unref?.()
}

export function abortTurn(sessionId: string) {
  const turn = turns.get(sessionId)
  if (turn && !turn.done) turn.controller.abort()
}

export function encodeTurnEvent(item: TurnEvent) {
  return `id: ${item.seq}\nevent: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`
}

export const TURN_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
}

/** 长工具期间没有事件时的保活间隔；SSE 注释行前端忽略。 */
export const TURN_HEARTBEAT_MS = 15_000

export function turnStream(turn: TurnBroadcast, signal: AbortSignal, afterSeq = 0) {
  let detach = () => {}
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        signal.removeEventListener('abort', disconnect)
        try { controller.close() } catch { /* 已断开 */ }
      }
      // 重新接上时若没有待重放事件（如正在跑长命令），响应头会憋到下一个事件才发出，
      // 前端 fetch 一直挂着、断线提示也一直不消失。先写一行注释把响应推出去，再定时保活。
      const comment = (text: string) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(`: ${text}\n\n`)) } catch { disconnect() }
      }
      const disconnect = () => { detach(); close() }
      comment('attached')
      heartbeat = setInterval(() => comment('ping'), TURN_HEARTBEAT_MS)
      heartbeat.unref?.()
      detach = subscribeTurn(turn, {
        send: item => { if (!closed) controller.enqueue(encoder.encode(encodeTurnEvent(item))) }, close,
      }, afterSeq)
      if (signal.aborted) disconnect()
      else if (!closed) signal.addEventListener('abort', disconnect, { once: true })
    },
    cancel() { closed = true; if (heartbeat) clearInterval(heartbeat); detach() },
  })
  return new Response(stream, { headers: TURN_STREAM_HEADERS })
}
