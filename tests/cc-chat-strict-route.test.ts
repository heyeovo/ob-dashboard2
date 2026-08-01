import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/havenTurns', () => ({ getTurnByRequestId: lookup }))

import { POST } from '@/app/api/cc-chat/route'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/cc-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/cc-chat strict request and replay', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires request_id, expected_last_round_id and persona_id', async () => {
    const response = await POST(request({ session_id: 's1', text: 'hello' }))
    expect(response.status).toBe(400)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('replays a matching saved turn without invoking the cc executor', async () => {
    lookup.mockResolvedValue({
      ok: true,
      found: true,
      error: '',
      turn: {
        id: 9,
        session_id: 's1',
        round_id: 3,
        user_text: 'hello',
        assistant_text: 'saved answer',
        model: 'claude-test',
        persona_id: 'ombre',
        raw_json: JSON.stringify({ engine: 'cc', persona_id: 'ombre', usage: { inputTokens: 2, outputTokens: 1 } }),
      },
    })
    const response = await POST(request({
      session_id: 's1', request_id: 'r1', expected_last_round_id: 2, persona_id: 'ombre', text: 'hello',
    }))
    const text = await response.text()
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(text).toContain('event: done')
    expect(text).toContain('"idempotent_replay":true')
    expect(text).toContain('saved answer')
  })

  it('rejects reuse of a request_id for different content', async () => {
    lookup.mockResolvedValue({
      ok: true,
      found: true,
      error: '',
      turn: { session_id: 's1', user_text: 'different', persona_id: 'ombre', raw_json: '{}' },
    })
    const response = await POST(request({
      session_id: 's1', request_id: 'r1', expected_last_round_id: 0, persona_id: 'ombre', text: 'hello',
    }))
    expect(response.status).toBe(409)
  })
})
