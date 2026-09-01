import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wake = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/app/lib/cc/backgroundWakeTurn', () => ({ runBackgroundWake: wake.run }))

import { POST } from '@/app/api/cc-agent-wake-runner/route'

const validBody = {
  wake_id: `wake_${'a'.repeat(32)}`,
  profile_id: 'default',
  session_id: 'window-1',
  lane_id: 'subscription',
  schedule_version: 4,
  lease_owner: 'scheduler-1',
  cause: 'conversation_silence',
  due_at: '2026-09-01T12:00:00Z',
  silence_source_turn_id: 9,
}

function request(body: unknown, token = 'wake-secret') {
  return new Request('http://localhost/api/cc-agent-wake-runner', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OMBRE_AGENT_WAKE_RUNNER_TOKEN = 'wake-secret'
  wake.run.mockResolvedValue({ status: 'completed', laneId: 'subscription', turnId: 18 })
})

afterEach(() => { delete process.env.OMBRE_AGENT_WAKE_RUNNER_TOKEN })

describe('Haven agent wake callback route', () => {
  it('rejects an invalid bearer token', async () => {
    const response = await POST(request(validBody, 'wrong'))
    expect(response.status).toBe(401)
    expect(wake.run).not.toHaveBeenCalled()
  })

  it('validates input before invoking the background runner', async () => {
    const response = await POST(request({ ...validBody, schedule_version: 0 }))
    expect(response.status).toBe(400)
    expect(wake.run).not.toHaveBeenCalled()
  })

  it('passes the persisted claim and returns the committed turn id', async () => {
    const response = await POST(request(validBody))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'completed', turn_id: 18 })
    expect(wake.run).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'window-1', laneId: 'subscription', leaseOwner: 'scheduler-1',
      scheduleVersion: 4, cause: 'conversation_silence', silenceSourceTurnId: 9,
    }))
  })
})
