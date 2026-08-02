import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ccSession = vi.hoisted(() => ({
  applyRuntimeSettings: vi.fn(),
  getSessionStats: vi.fn(),
  peekSession: vi.fn(),
}))

const haven = vi.hoisted(() => ({
  getConversationSession: vi.fn(),
  patchConversationSessionState: vi.fn(),
}))

vi.mock('@/app/lib/ccSession', () => ccSession)
vi.mock('@/app/lib/havenTurns', () => haven)

import { POST } from '@/app/api/cc-session-settings/route'

beforeEach(() => {
  vi.clearAllMocks()
  ccSession.getSessionStats.mockReturnValue({ turnCount: 0 })
  haven.getConversationSession.mockResolvedValue({
    ok: true,
    found: true,
    session: {
      state_version: 7,
      selfhost_overrides: { history_token_budget: 88_000, model: 'old-model' },
    },
    error: '',
  })
  haven.patchConversationSessionState.mockResolvedValue({
    ok: true,
    session: { selfhost_overrides: { provider_id: 'relay', model: 'new-model' } },
    error: '',
    httpStatus: 200,
  })
})

describe('/api/cc-session-settings', () => {
  it('persists a selfhost window pick in Haven without dropping existing budget overrides', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cc-session-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 's1',
        engine: 'selfhost',
        persona_id: 'ombre',
        provider_id: 'relay',
        model: 'new-model',
      }),
    }))

    expect(response.status).toBe(200)
    expect(haven.patchConversationSessionState).toHaveBeenCalledWith({
      sessionId: 's1',
      personaId: 'ombre',
      selfhostOverrides: {
        history_token_budget: 88_000,
        provider_id: 'relay',
        model: 'new-model',
      },
      expectedStateVersion: 7,
    })
    expect(ccSession.peekSession).not.toHaveBeenCalled()
  })

  it('keeps the existing cc runtime-only behavior unchanged', async () => {
    ccSession.peekSession.mockReturnValue(null)
    const response = await POST(new NextRequest('http://localhost/api/cc-session-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', model: 'cc-model' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.applied).toBe(false)
    expect(haven.getConversationSession).not.toHaveBeenCalled()
  })
})
