import { beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ load: vi.fn() }))
const runner = vi.hoisted(() => ({ run: vi.fn() }))
const live = vi.hoisted(() => ({ peek: vi.fn(), pending: vi.fn() }))
const haven = vi.hoisted(() => ({ record: vi.fn() }))

vi.mock('@/app/lib/cc/turnInputs', () => ({ loadBackgroundTurnInputs: loader.load }))
vi.mock('@/app/lib/cc/runTurn', () => ({ runTurn: runner.run }))
vi.mock('@/app/lib/ccSession', () => ({ peekSession: live.peek }))
vi.mock('@/app/lib/ccChannel', () => ({ hasPending: live.pending }))
vi.mock('@/app/lib/havenTurns', () => ({ recordTurnStrict: haven.record }))

import { runBackgroundWake } from '@/app/lib/cc/backgroundWakeTurn'

beforeEach(() => {
  vi.clearAllMocks()
  live.peek.mockReturnValue(null)
  live.pending.mockReturnValue(false)
  loader.load.mockResolvedValue({
    persona: { id: 'ombre' },
    config: { laneId: 'subscription', model: 'claude-test', cred: 'subscription' },
    sessionSnapshot: { ok: true, session: { cc_seen_round_id: 3 } },
    resumeHint: 'native-session',
    laneId: 'subscription',
  })
  runner.run.mockResolvedValue({ ok: true, phase: 'succeeded', assistantText: '醒了' })
  haven.record.mockResolvedValue({ ok: true, stored: true, turnId: 4, roundId: 4 })
})

describe('Dashboard background wake runner', () => {
  it('restores one lane and invokes the common turn without persistence or SSE', async () => {
    const result = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-1', at: '2026-08-31T12:55:00Z', cause: 'cache_keepalive',
    })
    expect(result).toMatchObject({ status: 'completed', laneId: 'subscription' })
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'window-1', requestId: 'wake-1', resumeHint: 'native-session',
      turnKind: 'agent_wake', persistTurn: false,
    }))
    expect(haven.record).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'wake-1', expectedLastRoundId: 3, turnKind: 'agent_wake', laneId: 'subscription',
    }))
  })

  it('does not call the model while approval/compaction state blocks the session', async () => {
    live.pending.mockReturnValue(true)
    const result = await runBackgroundWake({
      sessionId: 'window-1', at: '2026-08-31T12:55:00Z', cause: 'agent_schedule',
    })
    expect(result).toEqual({ status: 'deferred', reason: 'session_blocked' })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('persists a no-op wake without creating visible assistant text', async () => {
    runner.run.mockResolvedValueOnce({
      ok: true,
      phase: 'succeeded',
      assistantText: '[agent_wake_noop]',
      modelActivityAt: Date.parse('2026-08-31T12:55:01Z'),
      wakeDecision: { action: 'schedule', at: '2026-08-31T13:25:00Z', reason: '稍后再看' },
    })
    const result = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-noop', at: '2026-08-31T12:55:00Z', cause: 'cache_keepalive',
    })
    expect(result).toMatchObject({ status: 'completed', turn: { assistantText: '' } })
    expect(haven.record).toHaveBeenCalledWith(expect.objectContaining({
      assistantText: '',
      agentWakeUpdate: expect.objectContaining({
        wake_cause: 'cache_keepalive',
        wake_decision: expect.objectContaining({ action: 'schedule' }),
      }),
    }))
  })
})
