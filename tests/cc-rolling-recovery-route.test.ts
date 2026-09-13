import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const haven = vi.hoisted(() => ({
  getConversationSession: vi.fn(),
  listAllTurns: vi.fn(),
  commitConversationRollingRecovery: vi.fn(),
}))
const personas = vi.hoisted(() => ({ getPersona: vi.fn() }))
const dirs = vi.hoisted(() => ({ resolveDirs: vi.fn() }))
const rolling = vi.hoisted(() => ({
  createManualRollingBodyRecoverySeed: vi.fn(),
  materializeRollingHistorySeed: vi.fn(),
}))
const windowPrompt = vi.hoisted(() => ({ buildRollingWindowHistory: vi.fn() }))
const sessions = vi.hoisted(() => ({
  prepareSessionForRollingRecovery: vi.fn(),
  activateRollingRecovery: vi.fn(),
}))

vi.mock('@/app/lib/havenTurns', () => haven)
vi.mock('@/app/lib/havenPersonas', () => personas)
vi.mock('@/app/lib/ccDirs', () => dirs)
vi.mock('@/app/lib/cc/ccOptions', () => ({
  ccLaneId: (cred: string, providerId: string) => cred === 'subscription' ? 'subscription' : `api:${providerId || 'default'}`,
}))
vi.mock('@/app/lib/cc/rollingHistory', () => rolling)
vi.mock('@/app/lib/cc/windowPrompt', () => windowPrompt)
vi.mock('@/app/lib/ccSession', () => sessions)

import { POST } from '@/app/api/cc-rolling-recovery/route'

const session = {
  persona_id: 'ombre', state_version: 5, context_revision: 3,
  rolling_context: { strategy: 'daily_rolling', day_modes: { '2026-09-13': 'raw' } },
  cc_overrides: { active_cred: 'subscription' },
  cc_lanes: { subscription: { cc_session_id: 'damaged-native', model: 'claude' } },
}

function request() {
  return new NextRequest('http://localhost/api/cc-rolling-recovery', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: 'session-1', persona_id: 'ombre', expected_state_version: 5,
      confirm: 'session-1',
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  haven.getConversationSession.mockResolvedValue({ ok: true, session, contextDays: [] })
  haven.listAllTurns.mockResolvedValue({ ok: true, turns: [{ id: 1 }] })
  personas.getPersona.mockResolvedValue({ ok: true, persona: { id: 'ombre', dirs: [] } })
  dirs.resolveDirs.mockResolvedValue({ cwd: 'C:/workspace', additionalDirectories: [] })
  windowPrompt.buildRollingWindowHistory.mockReturnValue([{ id: 1 }, { id: 2 }])
  rolling.createManualRollingBodyRecoverySeed.mockReturnValue({
    resumeFrom: 'restored-native', entries: [{}, {}, {}, {}], sessionStore: {},
  })
  rolling.materializeRollingHistorySeed.mockResolvedValue(undefined)
  sessions.prepareSessionForRollingRecovery.mockReturnValue({ ok: true, error: '' })
  haven.commitConversationRollingRecovery.mockResolvedValue({ ok: true, session: { ...session, state_version: 6 } })
})

describe('/api/cc-rolling-recovery', () => {
  it('materializes the body seed before atomically switching Haven and local resume state', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(rolling.materializeRollingHistorySeed).toHaveBeenCalledOnce()
    expect(haven.commitConversationRollingRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedCcSessionId: 'damaged-native',
      nextCcSessionId: 'restored-native',
      contextRevision: 3,
      turnCount: 2,
      entryCount: 4,
    }))
    expect(rolling.materializeRollingHistorySeed.mock.invocationCallOrder[0])
      .toBeLessThan(haven.commitConversationRollingRecovery.mock.invocationCallOrder[0])
    expect(sessions.activateRollingRecovery).toHaveBeenCalledWith(
      'session-1', 'subscription', 3, 'restored-native',
    )
  })

  it('does not activate the new resume point when Haven rejects the CAS switch', async () => {
    haven.commitConversationRollingRecovery.mockResolvedValueOnce({
      ok: false, session: null, error: 'cc_session_id_conflict', httpStatus: 409,
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(sessions.activateRollingRecovery).not.toHaveBeenCalled()
  })
})
