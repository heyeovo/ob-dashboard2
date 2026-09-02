import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const haven = vi.hoisted(() => ({
  getAgentWakeSchedule: vi.fn(),
  patchAgentWakeSchedule: vi.fn(),
}))

vi.mock('@/app/lib/havenTurns', () => haven)

import { PATCH } from '@/app/api/cc-agent-wake/route'

beforeEach(() => {
  vi.clearAllMocks()
  haven.patchAgentWakeSchedule.mockResolvedValue({
    ok: true,
    schedule: { schedule_version: 8, conversation_silence_enabled: false },
    error: '',
    httpStatus: 200,
  })
})

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/cc-agent-wake', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: 'window-1',
      lane_id: 'subscription',
      expected_version: 7,
      ...body,
    }),
  })
}

describe('/api/cc-agent-wake', () => {
  it('passes the independent silence switch through to Haven', async () => {
    const response = await PATCH(request({
      changes: { conversation_silence_enabled: true },
    }))

    expect(response.status).toBe(200)
    expect(haven.patchAgentWakeSchedule).toHaveBeenCalledWith({
      sessionId: 'window-1',
      laneId: 'subscription',
      expectedVersion: 7,
      changes: { conversation_silence_enabled: true },
    })
  })

  it('passes the window Bark switch through to Haven', async () => {
    const response = await PATCH(request({
      changes: { bark_notification_enabled: true },
    }))

    expect(response.status).toBe(200)
    expect(haven.patchAgentWakeSchedule).toHaveBeenCalledWith(expect.objectContaining({
      changes: { bark_notification_enabled: true },
    }))
  })

  it('turns silence off and clears its pending timer when stopping all wakes', async () => {
    const response = await PATCH(request({ action: 'stop_all' }))

    expect(response.status).toBe(200)
    expect(haven.patchAgentWakeSchedule).toHaveBeenCalledWith(expect.objectContaining({
      changes: expect.objectContaining({
        conversation_silence_enabled: false,
        conversation_silence_check_at: '',
        silence_source_turn_id: 0,
        silence_policy_version: '',
      }),
    }))
  })
})
