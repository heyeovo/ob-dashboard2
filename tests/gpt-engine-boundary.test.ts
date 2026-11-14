import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const lookup = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/havenTurns', async importOriginal => ({
  ...await importOriginal<typeof import('@/app/lib/havenTurns')>(), getTurnByRequestId: lookup,
}))
import { prepareSelfhostTurn } from '@/app/lib/selfhost/runSelfhostTurn'
import { POST } from '@/app/api/cc-chat/route'
import { GET as attach } from '@/app/api/cc-chat/attach/route'
import { activeTurn, createTurnBroadcast, finishTurn } from '@/app/lib/cc/turnBroadcast'

describe('GPT engine isolation', () => {
  const body = { session_id: 'gpt-boundary', request_id: 'r-boundary', persona_id: 'ombre', text: 'hello', expected_last_round_id: 0 }
  function request() { return new NextRequest('http://localhost/api/cc-chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) }
  it('saved GPT turns cannot be replayed as Claude CC or selfhost turns', async () => {
    lookup.mockResolvedValue({ ok: true, found: true, turn: { ...body, user_text: 'hello', source: 'gpt_subscription', raw_json: '{}' } })
    expect((await POST(request())).status).toBe(409)
    const prepared = await prepareSelfhostTurn({ sessionId: body.session_id, requestId: body.request_id,
      personaId: 'ombre', text: 'hello', expectedLastRoundId: 0, mode: 'chat', includeDailyReview: false })
    expect(prepared.kind).toBe('error')
  })
  it('live GPT events cannot attach through the CC route or appear as an active Claude turn', async () => {
    lookup.mockResolvedValue({ ok: true, found: false })
    const turn = createTurnBroadcast({ engine: 'gpt_subscription', sessionId: body.session_id, requestId: body.request_id,
      userText: 'hello', attachmentIds: [], startedAt: Date.now() }, vi.fn())!
    try {
      expect(activeTurn(body.session_id)).toBeNull()
      expect(attach(new NextRequest(`http://localhost/api/cc-chat/attach?session_id=${body.session_id}&request_id=${body.request_id}`)).status).toBe(404)
      const response = await POST(request())
      expect(response.status).toBe(409)
      expect((await response.json()).error).toBe('engine_mismatch')
    } finally { finishTurn(turn) }
  })
})
