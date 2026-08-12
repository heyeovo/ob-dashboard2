import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const api = vi.hoisted(() => ({ getSessionCookie: vi.fn() }))

vi.mock('@/app/lib/api', () => ({
  BASE_URL: 'https://haven.test',
  getSessionCookie: api.getSessionCookie,
}))

import { GET, POST } from '@/app/api/prompts/route'
import { POST as RESET } from '@/app/api/prompts/reset/route'
import { POST as TEST } from '@/app/api/prompts/test/route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  api.getSessionCookie.mockResolvedValue('ombre_session=test')
})

describe('/api/prompts proxies', () => {
  it('loads detailed prompt state without cache', async () => {
    const payload = { version: 1, prompts: { analyze: { content: '正文' } } }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://haven.test/api/prompts', {
      headers: { Cookie: 'ombre_session=test' }, cache: 'no-store',
    })
  })

  it('preserves revision conflicts from save and reset', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      error: 'revision changed', code: 'revision_conflict',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const body = { name: 'daily_review', expected_revision: 2 }

    const save = await POST(new NextRequest('http://localhost/api/prompts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, content: '新正文' }),
    }))
    const reset = await RESET(new NextRequest('http://localhost/api/prompts/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))

    expect(save.status).toBe(409)
    expect(reset.status).toBe(409)
  })

  it('forwards isolated test payload without rewriting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const body = { name: 'analyze', content: '草稿', sample_input: '样本文本' }

    await TEST(new NextRequest('http://localhost/api/prompts/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))

    expect(fetchMock).toHaveBeenCalledWith('https://haven.test/api/prompts/test', expect.objectContaining({
      method: 'POST', body: JSON.stringify(body),
    }))
  })
})
