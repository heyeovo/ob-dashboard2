import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  activeTurn, createTurnBroadcast, encodeTurnEvent, finishTurn, getTurnBroadcast,
  publishTurn, subscribeTurn, turnStream, TURN_BUFFER_BYTES, TURN_RETENTION_MS, TURN_HEARTBEAT_MS, TURN_UNATTENDED_MS,
} from '@/app/lib/cc/turnBroadcast'
import { GET } from '@/app/api/cc-chat/attach/route'
import { dropSession } from '@/app/lib/ccSession'

let count = 0
function create(stop = vi.fn(async () => {})) {
  return createTurnBroadcast({ sessionId: `broadcast-${++count}`, requestId: `r-${count}`,
    userText: 'hello', attachmentIds: ['a1'], startedAt: Date.now() }, stop)!
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('foreground turn broadcast', () => {
  it('numbers immutable snapshots and replays only after_seq, then sends live events', () => {
    const turn = create()
    const data = { status: 'running' }
    publishTurn(turn, 'tool', data)
    data.status = 'completed'
    publishTurn(turn, 'delta', { text: 'first' })
    expect(turn.events[0].data).toEqual({ status: 'running' })
    const send = vi.fn(), close = vi.fn()
    subscribeTurn(turn, { send, close }, 1)
    publishTurn(turn, 'done', { round_id: 1 })
    expect(send.mock.calls.map(([item]) => item.seq)).toEqual([2, 3])
    expect(encodeTurnEvent(turn.events[2])).toContain('id: 3\n')
    finishTurn(turn)
    expect(close).toHaveBeenCalledOnce()
  })

  it('allows only one active turn and retains completion for two minutes', () => {
    const turn = create()
    expect(createTurnBroadcast(turn, vi.fn())).toBeNull()
    publishTurn(turn, 'done', {})
    finishTurn(turn)
    expect(activeTurn(turn.sessionId)).toBeNull()
    const close = vi.fn(), send = vi.fn()
    subscribeTurn(turn, { send, close })
    expect(send).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(TURN_RETENTION_MS - 1)
    expect(getTurnBroadcast(turn.sessionId)).toBe(turn)
    vi.advanceTimersByTime(1)
    expect(getTurnBroadcast(turn.sessionId)).toBeUndefined()
  })

  it('marks oversized buffers truncated, still forwards live events, refuses attach', async () => {
    const turn = create(), send = vi.fn()
    subscribeTurn(turn, { send, close: vi.fn() })
    publishTurn(turn, 'delta', { text: '字'.repeat(Math.ceil(TURN_BUFFER_BYTES / 3)) })
    expect(turn.truncated).toBe(true)
    expect(turn.events).toHaveLength(0)
    publishTurn(turn, 'done', {})
    expect(send).toHaveBeenCalledTimes(2)
    const response = GET(new NextRequest(`http://localhost/api/cc-chat/attach?session_id=${turn.sessionId}&request_id=${turn.requestId}`))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, reason: 'truncated' })
  })

  it('request abort only removes its subscriber; explicit drop aborts the turn', async () => {
    const turn = create(), request = new AbortController()
    const response = turnStream(turn, request.signal)
    const reader = response.body!.getReader()
    request.abort()
    // 先读到立即推出响应的注释行，随后流关闭
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': attached\n\n')
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(turn.subscribers.size).toBe(0)
    expect(turn.controller.signal.aborted).toBe(false)
    dropSession(turn.sessionId, 'manual_delete')
    expect(turn.controller.signal.aborted).toBe(true)
  })

  it('flushes immediately on attach and keeps the stream alive while no events arrive', async () => {
    const turn = create(), request = new AbortController()
    const reader = turnStream(turn, request.signal, 0).body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe(': attached\n\n')
    await vi.advanceTimersByTimeAsync(TURN_HEARTBEAT_MS)
    expect(decoder.decode((await reader.read()).value)).toBe(': ping\n\n')
    request.abort()
  })

  it('reader cancel detaches without aborting generation', async () => {
    const turn = create()
    await turnStream(turn, new AbortController().signal).body!.cancel()
    expect(turn.subscribers.size).toBe(0)
    expect(turn.controller.signal.aborted).toBe(false)
  })

  it('stops only after a continuous 30 minutes without any subscribers', async () => {
    const stop = vi.fn(async () => {}), turn = create(stop)
    const detach = subscribeTurn(turn, { send: vi.fn(), close: vi.fn() })
    await vi.advanceTimersByTimeAsync(TURN_UNATTENDED_MS)
    expect(stop).not.toHaveBeenCalled()
    detach()
    await vi.advanceTimersByTimeAsync(TURN_UNATTENDED_MS - 1)
    const detachAgain = subscribeTurn(turn, { send: vi.fn(), close: vi.fn() })
    await vi.advanceTimersByTimeAsync(2)
    expect(stop).not.toHaveBeenCalled()
    detachAgain()
    await vi.advanceTimersByTimeAsync(TURN_UNATTENDED_MS)
    expect(stop).toHaveBeenCalledOnce()
    expect(turn.controller.signal.aborted).toBe(false)
  })

  it('attach returns sequenced replay, closes completed turns, validates missing turns', async () => {
    const turn = create()
    publishTurn(turn, 'delta', { text: 'missed' })
    publishTurn(turn, 'done', { round_id: 1 })
    finishTurn(turn)
    const response = GET(new NextRequest(`http://localhost/api/cc-chat/attach?session_id=${turn.sessionId}&request_id=${turn.requestId}&after_seq=1`))
    const text = await response.text()
    expect(text).toContain('id: 2\nevent: done')
    expect(text).not.toContain('missed')
    expect(GET(new NextRequest('http://localhost/api/cc-chat/attach?session_id=missing&request_id=r')).status).toBe(404)
    expect(GET(new NextRequest('http://localhost/api/cc-chat/attach?session_id=s&request_id=r&after_seq=-1')).status).toBe(400)
  })
})
