import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { clearSessionCookie } from '@/app/lib/api'
import { GET } from '@/app/api/haven/[...path]/route'

afterEach(() => {
  clearSessionCookie()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Haven Brain proxy runtime configuration', () => {
  it('logs in server-side and preserves the existing /api path contract', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.example/root/')
    vi.stubEnv('OMBRE_SESSION', 'server-brain-secret')
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/login')) {
        expect(init?.body).toBe(JSON.stringify({ password: 'server-brain-secret' }))
        return new Response(null, {
          status: 200,
          headers: { 'Set-Cookie': 'haven_session=fake-cookie; Path=/; HttpOnly' },
        })
      }
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', upstream)

    const response = await GET(
      new NextRequest('https://dashboard.example/api/haven/portrait-state/stable?full=1'),
      { params: Promise.resolve({ path: ['portrait-state', 'stable'] }) },
    )

    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(upstream.mock.calls[0][0]).toBe('https://haven.example/root/auth/login')
    expect(upstream.mock.calls[1][0]).toBe('https://haven.example/root/api/portrait-state/stable?full=1')
    expect(JSON.stringify(await response.json())).not.toContain('server-brain-secret')
  })

  it('fails before fetching when the production Brain session is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.example')
    vi.stubEnv('OMBRE_SESSION', '')
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await GET(
      new NextRequest('https://dashboard.example/api/haven/portrait-state'),
      { params: Promise.resolve({ path: ['portrait-state'] }) },
    )

    expect(response.status).toBe(502)
    expect(upstream).not.toHaveBeenCalled()
    expect(await response.text()).toContain('缺少 OMBRE_SESSION')
  })
})
