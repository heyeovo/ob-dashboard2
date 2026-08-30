import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ccSession = vi.hoisted(() => ({ getProUsage: vi.fn() }))
const haven = vi.hoisted(() => ({
  loadProUsageSnapshot: vi.fn(),
  saveProUsageSnapshot: vi.fn(),
}))

vi.mock('@/app/lib/ccSession', () => ccSession)
vi.mock('@/app/lib/havenProUsage', () => haven)

import { GET } from '@/app/api/cc-pro-usage/route'

const fresh = {
  available: true,
  stale: false,
  experimental: true as const,
  subscriptionType: 'pro',
  fiveHour: { utilization: 25, resetsAt: null },
  sevenDay: null,
  updatedAt: '2026-08-30T01:00:00.000Z',
  note: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  haven.saveProUsageSnapshot.mockResolvedValue({ ok: true, snapshot: fresh, error: '' })
})

describe('/api/cc-pro-usage', () => {
  it('overwrites the global Haven snapshot after a fresh SDK read', async () => {
    ccSession.getProUsage.mockResolvedValue(fresh)
    const response = await GET(new NextRequest('http://localhost/api/cc-pro-usage?session_id=s1'))
    expect(response.status).toBe(200)
    expect(haven.saveProUsageSnapshot).toHaveBeenCalledWith(fresh)
    expect(haven.loadProUsageSnapshot).not.toHaveBeenCalled()
  })

  it('returns the persisted global snapshot as stale after a Dashboard restart', async () => {
    ccSession.getProUsage.mockResolvedValue({
      ...fresh,
      available: false,
      stale: true,
      updatedAt: '',
      note: '使用 Pro 线路完成一轮后可读取额度',
    })
    haven.loadProUsageSnapshot.mockResolvedValue({ ok: true, snapshot: fresh, error: '' })
    const response = await GET(new NextRequest('http://localhost/api/cc-pro-usage?session_id=other-window'))
    const payload = await response.json()
    expect(payload.usage).toMatchObject({
      available: true,
      stale: true,
      updatedAt: fresh.updatedAt,
    })
    expect(haven.saveProUsageSnapshot).not.toHaveBeenCalled()
  })
})
