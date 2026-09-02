import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const haven = vi.hoisted(() => ({
  getBarkNotifications: vi.fn(),
  patchBarkNotifications: vi.fn(),
  enqueueBarkTest: vi.fn(),
}))

vi.mock('@/app/lib/havenTurns', () => haven)

import { GET, PATCH, POST } from '@/app/api/cc-notifications/route'

beforeEach(() => {
  vi.clearAllMocks()
  haven.getBarkNotifications.mockResolvedValue({
    ok: true,
    config: { enabled: true, has_device_key: true, device_key_masked: 'abcd...wxyz' },
    recent: { status: 'sent', sent_count: 2, total_count: 2 },
    error: '',
    httpStatus: 200,
  })
  haven.patchBarkNotifications.mockResolvedValue({
    ok: true,
    config: { enabled: true, has_device_key: true, device_key_masked: 'abcd...wxyz' },
    error: '',
    httpStatus: 200,
  })
  haven.enqueueBarkTest.mockResolvedValue({ ok: true, queued: true, error: '', httpStatus: 200 })
})

describe('/api/cc-notifications', () => {
  it('reads profile config and current-window recent status', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/cc-notifications?session_id=window-1&lane_id=subscription',
    ))
    expect(response.status).toBe(200)
    expect(haven.getBarkNotifications).toHaveBeenCalledWith({
      sessionId: 'window-1',
      laneId: 'subscription',
    })
  })

  it('passes new secrets only in the save request', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/cc-notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: { device_key: 'new-secret', encryption_key: '1234567890abcdef' } }),
    }))
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(haven.patchBarkNotifications).toHaveBeenCalledWith({
      device_key: 'new-secret',
      encryption_key: '1234567890abcdef',
    })
    expect(JSON.stringify(payload)).not.toContain('new-secret')
    expect(JSON.stringify(payload)).not.toContain('1234567890abcdef')
  })

  it('queues an explicit test push', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cc-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    }))
    expect(response.status).toBe(200)
    expect(haven.enqueueBarkTest).toHaveBeenCalledOnce()
  })
})
