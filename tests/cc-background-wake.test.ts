import { beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ load: vi.fn() }))
const runner = vi.hoisted(() => ({ run: vi.fn() }))
const live = vi.hoisted(() => ({ peek: vi.fn(), pending: vi.fn() }))

vi.mock('@/app/lib/cc/turnInputs', () => ({ loadBackgroundTurnInputs: loader.load }))
vi.mock('@/app/lib/cc/runTurn', () => ({ runTurn: runner.run }))
vi.mock('@/app/lib/ccSession', () => ({ peekSession: live.peek }))
vi.mock('@/app/lib/ccChannel', () => ({ hasPending: live.pending }))

import { runBackgroundWake } from '@/app/lib/cc/backgroundWakeTurn'

beforeEach(() => {
  vi.clearAllMocks()
  live.peek.mockReturnValue(null)
  live.pending.mockReturnValue(false)
  loader.load.mockResolvedValue({
    persona: { id: 'ombre' },
    config: { laneId: 'subscription' },
    sessionSnapshot: { ok: true, session: {} },
    resumeHint: 'native-session',
    laneId: 'subscription',
  })
  runner.run.mockResolvedValue({ ok: true, phase: 'succeeded', assistantText: '醒了' })
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
  })

  it('does not call the model while approval/compaction state blocks the session', async () => {
    live.pending.mockReturnValue(true)
    const result = await runBackgroundWake({
      sessionId: 'window-1', at: '2026-08-31T12:55:00Z', cause: 'agent_schedule',
    })
    expect(result).toEqual({ status: 'deferred', reason: 'session_blocked' })
    expect(runner.run).not.toHaveBeenCalled()
  })
})
