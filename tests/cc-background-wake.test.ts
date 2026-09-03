import { beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ load: vi.fn() }))
const runner = vi.hoisted(() => ({ run: vi.fn() }))
const live = vi.hoisted(() => ({ peek: vi.fn(), pending: vi.fn() }))
const haven = vi.hoisted(() => ({ record: vi.fn(), getTurn: vi.fn(), begin: vi.fn() }))

vi.mock('@/app/lib/cc/turnInputs', () => ({ loadBackgroundTurnInputs: loader.load }))
vi.mock('@/app/lib/cc/runTurn', () => ({ runTurn: runner.run }))
vi.mock('@/app/lib/ccSession', () => ({ peekSession: live.peek }))
vi.mock('@/app/lib/ccChannel', () => ({ hasPending: live.pending }))
vi.mock('@/app/lib/havenTurns', () => ({
  recordTurnStrict: haven.record,
  getTurnByRequestId: haven.getTurn,
  beginAgentWakeRun: haven.begin,
}))

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
  haven.getTurn.mockResolvedValue({ ok: true, found: false, turn: null, error: '', httpStatus: 404 })
  haven.begin.mockResolvedValue({ ok: true, status: 'started', run: {}, error: '', httpStatus: 200 })
})

describe('Dashboard background wake runner', () => {
  it('restores one lane and invokes the common turn without persistence or SSE', async () => {
    const result = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-1', at: '2026-08-31T12:55:00Z', cause: 'cache_keepalive',
    })
    expect(result).toMatchObject({ status: 'completed', laneId: 'subscription' })
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'window-1', requestId: 'wake-1', resumeHint: 'native-session',
      text: '<agent_wake cause="cache_keepalive"/>',
      turnKind: 'agent_wake', persistTurn: false,
    }))
    expect(haven.record).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'wake-1', expectedLastRoundId: 3, turnKind: 'agent_wake', laneId: 'subscription',
    }))
  })

  it('sends only the cause and optional reason to the model', async () => {
    await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-scheduled', at: '2026-08-31T12:55:00Z',
      cause: 'agent_schedule', reason: '稍后再看',
    })

    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'wake-scheduled',
      text: '<agent_wake cause="agent_schedule" reason="稍后再看"/>',
    }))
  })

  it('begins the persisted run only after the coordinator gate and rejects a stale lane', async () => {
    const stale = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-stale', at: '2026-08-31T12:55:00Z',
      cause: 'cache_keepalive', laneId: 'api:old', leaseOwner: 'scheduler-1', scheduleVersion: 3,
    })
    expect(stale).toEqual({ status: 'superseded', reason: 'claimed_lane_is_not_active' })
    expect(haven.begin).not.toHaveBeenCalled()
    expect(runner.run).not.toHaveBeenCalled()

    const started = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-current', at: '2026-08-31T12:55:00Z',
      cause: 'cache_keepalive', laneId: 'subscription', leaseOwner: 'scheduler-1', scheduleVersion: 3,
    })
    expect(started.status).toBe('completed')
    expect(haven.begin).toHaveBeenCalledBefore(runner.run)
  })

  it('replays an already persisted wake without another model request', async () => {
    haven.getTurn.mockResolvedValueOnce({
      ok: true, found: true, error: '', httpStatus: 200,
      turn: { id: 19, session_id: 'window-1', turn_kind: 'agent_wake' },
    })
    const result = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-replay', at: '2026-08-31T12:55:00Z',
      cause: 'agent_schedule', laneId: 'subscription', leaseOwner: 'scheduler-1', scheduleVersion: 3,
    })
    expect(result).toMatchObject({ status: 'completed', turnId: 19, replayed: true })
    expect(haven.begin).not.toHaveBeenCalled()
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('does not call the model when Haven invalidates or limits the claimed run', async () => {
    haven.begin.mockResolvedValueOnce({ ok: true, status: 'superseded', run: {}, error: '', httpStatus: 200 })
    const stale = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-old', at: '2026-08-31T12:55:00Z',
      cause: 'conversation_silence', laneId: 'subscription', leaseOwner: 'scheduler-1', scheduleVersion: 2,
    })
    expect(stale.status).toBe('superseded')
    expect(runner.run).not.toHaveBeenCalled()

    haven.begin.mockResolvedValueOnce({ ok: true, status: 'limit_reached', run: {}, error: '', httpStatus: 200 })
    const limited = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-limit', at: '2026-08-31T12:55:00Z',
      cause: 'cache_keepalive', laneId: 'subscription', leaseOwner: 'scheduler-1', scheduleVersion: 3,
    })
    expect(limited).toEqual({ status: 'deferred', reason: 'session_blocked' })
    expect(runner.run).not.toHaveBeenCalled()
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
      assistantText: '[agent_wake_noop] 路过了，不打扰',
      thinking: '她现在应该在忙，先不打扰。',
      process: [{ type: 'thinking', id: 'thinking-1', text: '她现在应该在忙，先不打扰。' }],
      modelActivityAt: Date.parse('2026-08-31T12:55:01Z'),
      cacheDiagnostic: {
        version: 1,
        dashboard_instance_id: 'dashboard-test',
        turn_kind: 'agent_wake',
        lane: 'subscription',
        cc_session_id: 'native-session',
        resume_hint: 'native-session',
        iterator: 'cold_resumed',
        iterator_created_at: '2026-08-31T12:55:00.000Z',
        model_request_started_at: '2026-08-31T12:55:01.000Z',
        system_hash: 'system-hash',
        tools_hash: 'tools-hash',
        mcp_hash: 'mcp-hash',
        options_hash: 'options-hash',
        tool_names: ['WebSearch', 'WebFetch'],
        mcp_server_names: ['agent-wake'],
      },
      wakeDecision: { action: 'schedule', at: '2026-08-31T13:25:00Z', reason: '稍后再看' },
    })
    const result = await runBackgroundWake({
      sessionId: 'window-1', wakeId: 'wake-noop', at: '2026-08-31T12:55:00Z', cause: 'cache_keepalive',
    })
    expect(result).toMatchObject({ status: 'completed', turn: { assistantText: '' } })
    expect(haven.record).toHaveBeenCalledWith(expect.objectContaining({
      assistantText: '',
      raw: expect.objectContaining({
        thinking: '她现在应该在忙，先不打扰。',
        process: expect.arrayContaining([expect.objectContaining({ type: 'thinking' })]),
        cache_diagnostic: expect.objectContaining({
          dashboard_instance_id: 'dashboard-test',
          iterator: 'cold_resumed',
          system_hash: 'system-hash',
          options_hash: 'options-hash',
        }),
      }),
      agentWakeUpdate: expect.objectContaining({
        wake_cause: 'cache_keepalive',
        agent_wake: expect.objectContaining({ status: '路过了，不打扰' }),
        wake_decision: expect.objectContaining({ action: 'schedule' }),
      }),
    }))
  })
})
