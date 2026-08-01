import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const selfhost = vi.hoisted(() => ({
  prepare: vi.fn(),
  createStream: vi.fn(),
}))

vi.mock('@/app/lib/selfhost/runSelfhostTurn', () => ({
  prepareSelfhostTurn: selfhost.prepare,
  createSelfhostStream: selfhost.createStream,
  sseResponse: (stream: ReadableStream<Uint8Array>) => new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  }),
}))

import { POST } from '@/app/api/cc-chat-selfhost/route'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/cc-chat-selfhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/cc-chat-selfhost', () => {
  beforeEach(() => {
    selfhost.prepare.mockReset()
    selfhost.createStream.mockReset()
  })

  it('rejects an incomplete strict request before orchestration', async () => {
    const response = await POST(request({ session_id: 's', text: 'hi' }))
    expect(response.status).toBe(400)
    expect(selfhost.prepare).not.toHaveBeenCalled()
    expect((await response.json()).error.code).toBe('invalid_request')
  })

  it('returns a preflight cross-device conflict as HTTP 409', async () => {
    selfhost.prepare.mockResolvedValue({
      kind: 'error',
      status: 409,
      error: {
        code: 'conversation_conflict',
        message: '另一端产生了新消息，请刷新后重试',
        stage: 'preflight',
        retryable: false,
        http_status: 409,
        request_id: 'r-1',
        generated_not_saved: false,
        expected_last_round_id: 2,
        actual_last_round_id: 3,
      },
    })
    const response = await POST(request({
      session_id: 's', request_id: 'r-1', expected_last_round_id: 2, persona_id: 'ombre', text: 'hi',
    }))
    expect(response.status).toBe(409)
    expect((await response.json()).error.actual_last_round_id).toBe(3)
  })

  it('returns an SSE response after successful preflight', async () => {
    const prepared = { kind: 'replay', request: {}, turn: {} }
    selfhost.prepare.mockResolvedValue(prepared)
    selfhost.createStream.mockReturnValue(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: done\ndata: {"idempotent_replay":true}\n\n'))
        controller.close()
      },
    }))
    const response = await POST(request({
      session_id: 's', request_id: 'r-1', expected_last_round_id: 0, persona_id: 'ombre', text: 'hi',
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(await response.text()).toContain('idempotent_replay')
    expect(selfhost.createStream).toHaveBeenCalledWith(prepared, expect.any(AbortSignal))
  })
})

