import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const api = vi.hoisted(() => ({
  getSessionCookie: vi.fn(),
}))

vi.mock('@/app/lib/api', () => ({
  BASE_URL: 'https://haven.test',
  getSessionCookie: api.getSessionCookie,
}))

import { GET, POST } from '@/app/api/automations/[...path]/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  api.getSessionCookie.mockResolvedValue('ombre_session=test')
})

describe('/api/automations allowlisted proxy', () => {
  it('forwards the exact confirm body and upstream status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'conflict',
      conflict: { code: 'open_journey_changed', message: '请重新生成候选' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const body = {
      expected_revision: 2,
      approved_payload_hash: 'a'.repeat(64),
    }

    const response = await POST(new NextRequest('http://localhost/api/automations/candidates/c-1/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ path: ['candidates', 'c-1', 'confirm'] }) })

    expect(response.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://haven.test/api/automations/candidates/c-1/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body), cache: 'no-store' }),
    )
  })

  it('rejects paths outside the automation allowlist before login or fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET(
      new NextRequest('http://localhost/api/automations/schedules/enable'),
      { params: Promise.resolve({ path: ['schedules', 'enable'] }) },
    )

    expect(response.status).toBe(404)
    expect(api.getSessionCookie).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
