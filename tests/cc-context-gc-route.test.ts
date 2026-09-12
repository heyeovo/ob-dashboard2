import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const haven = vi.hoisted(() => ({
  getConversationSession: vi.fn(),
  patchConversationContextGc: vi.fn(),
}))
const gc = vi.hoisted(() => ({
  scanContextGc: vi.fn(),
  applyContextGc: vi.fn(),
  purgeSupersededTranscripts: vi.fn(),
}))
const sessions = vi.hoisted(() => ({
  prepareSessionForContextGc: vi.fn(),
  activateContextGcFork: vi.fn(),
}))

vi.mock('@/app/lib/havenTurns', () => haven)
vi.mock('@/app/lib/contextGc', () => gc)
vi.mock('@/app/lib/ccSession', () => sessions)

import { GET, PATCH } from '@/app/api/cc-context-gc/route'

function state(strategy: 'fixed_window' | 'daily_rolling') {
  return {
    ok: true,
    session: {
      persona_id: 'ombre', state_version: 3, context_revision: 2,
      rolling_context: { strategy },
      context_gc: { auto_enabled: false, protected_keys: [], history: [] },
      cc_lanes: { subscription: { cc_session_id: 'native-1', context_revision: 2 } },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  gc.scanContextGc.mockResolvedValue({ candidates: [], estimatedTokens: 0 })
})

describe('/api/cc-context-gc daily rolling gate', () => {
  it('blocks scanning and manual GC for daily rolling while leaving fixed scanning unchanged', async () => {
    haven.getConversationSession.mockResolvedValueOnce(state('daily_rolling'))
    const blocked = await GET(new NextRequest(
      'http://localhost/api/cc-context-gc?session_id=s1&lane_id=subscription',
    ))
    expect(blocked.status).toBe(400)
    expect((await blocked.json()).error).toContain('暂不可用')
    expect(gc.scanContextGc).not.toHaveBeenCalled()

    haven.getConversationSession.mockResolvedValueOnce(state('fixed_window'))
    const fixed = await GET(new NextRequest(
      'http://localhost/api/cc-context-gc?session_id=s1&lane_id=subscription',
    ))
    expect(fixed.status).toBe(200)
    expect(gc.scanContextGc).toHaveBeenCalledWith('native-1', [])
  })

  it('rejects enabling daily rolling auto GC but still permits turning an old switch off', async () => {
    haven.getConversationSession.mockResolvedValueOnce(state('daily_rolling'))
    const enable = await PATCH(new NextRequest('http://localhost/api/cc-context-gc', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', auto_enabled: true }),
    }))
    expect(enable.status).toBe(400)
    expect(haven.patchConversationContextGc).not.toHaveBeenCalled()

    haven.getConversationSession.mockResolvedValueOnce(state('daily_rolling'))
    haven.patchConversationContextGc.mockResolvedValueOnce({ ok: true, session: state('daily_rolling').session })
    const disable = await PATCH(new NextRequest('http://localhost/api/cc-context-gc', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', auto_enabled: false }),
    }))
    expect(disable.status).toBe(200)
    expect(haven.patchConversationContextGc).toHaveBeenCalledWith(expect.objectContaining({
      preferences: { auto_enabled: false },
    }))
  })
})
