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
import { buildHandoffSnapshot } from '@/app/lib/cc/handoffSnapshot'

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


describe('GPT window preference', () => {
  const snapshot = buildHandoffSnapshot([{ kind: 'chat', id: 'turn-1', title: '旧窗口', content: '测试对话' }])
  const handoffRequest = (handoffSnapshot: unknown = snapshot) => new NextRequest('http://localhost/api/cc-session-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'new-window', persona_id: 'ombre', engine: 'gpt_subscription',
      model: 'gpt-test', handoff_snapshot: handoffSnapshot }),
  })

  it('saves the new GPT window and handoff snapshot together before any turns', async () => {
    haven.getConversationSession.mockResolvedValueOnce({ ok: true, found: false, session: null })
    const response = await POST(handoffRequest())
    expect(response.status).toBe(200)
    expect(haven.patchConversationSessionState).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'new-window', personaId: 'ombre', localEnginePreference: 'gpt_subscription',
      gptSubscriptionOverrides: { model: 'gpt-test' }, expectedStateVersion: 0,
      mode: 'chat', dailyReviewEnabled: false, handoffSnapshot: snapshot,
    })
    expect(ccSession.applyRuntimeSettings).not.toHaveBeenCalled()
  })

  it('reconciles a retry without rewriting the saved snapshot or replacing another window', async () => {
    haven.getConversationSession.mockResolvedValueOnce({ ok: true, found: true, session: {
      persona_id: 'ombre', local_engine_preference: 'gpt_subscription', gpt_subscription_overrides: { model: 'gpt-test' },
      mode: 'chat', handoff_snapshot: snapshot, state_version: 1,
    } })
    expect((await POST(handoffRequest())).status).toBe(200)
    expect((await POST(handoffRequest())).status).toBe(409)
    expect(haven.patchConversationSessionState).not.toHaveBeenCalled()
  })

  it('rejects malformed handoff data without persisting any changes', async () => {
    expect((await POST(handoffRequest({ version: 1 }))).status).toBe(400)
    expect(haven.patchConversationSessionState).not.toHaveBeenCalled()
  })

  it('persists model and engine with CAS without touching Claude runtime or other overrides', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cc-session-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', persona_id: 'ombre', engine: 'gpt_subscription', model: 'gpt-test' }),
    }))
    expect(response.status).toBe(200)
    expect(haven.patchConversationSessionState).toHaveBeenCalledWith({ sessionId: 's1', personaId: 'ombre',
      localEnginePreference: 'gpt_subscription', gptSubscriptionOverrides: { model: 'gpt-test' }, expectedStateVersion: 7 })
    expect(ccSession.peekSession).not.toHaveBeenCalled()
    expect(ccSession.applyRuntimeSettings).not.toHaveBeenCalled()
    expect((await response.json()).applied).toBe(false)
  })
})
