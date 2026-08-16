import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/gateway/[...path]/route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Gateway proxy runtime configuration', () => {
  it('joins the existing gateway path and injects only the server token', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.example/root/')
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'server-gateway-secret')
    const upstream = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstream)

    const request = new NextRequest('https://dashboard.example/api/gateway/api/config?full=1', {
      headers: {
        Authorization: 'Bearer browser-secret',
        'x-api-key': 'browser-api-key',
        'x-ombre-session-id': 'session-1',
      },
    })
    const response = await GET(request, { params: Promise.resolve({ path: ['api', 'config'] }) })

    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledOnce()
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://haven.example/root/gateway/api/config?full=1')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer server-gateway-secret',
      'X-Ombre-Session-Id': 'session-1',
    })
    expect(init.headers).not.toHaveProperty('x-api-key')
    expect(JSON.stringify(init.headers)).not.toContain('browser-secret')
    expect(await response.text()).not.toContain('server-gateway-secret')
  })

  it('returns a safe 503 when production configuration is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', '')
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'do-not-leak-this-token')
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await GET(
      new NextRequest('https://dashboard.example/api/gateway/api/config'),
      { params: Promise.resolve({ path: ['api', 'config'] }) },
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
    expect(body).toContain('缺少 HAVEN_GATEWAY_URL')
    expect(body).not.toContain('do-not-leak-this-token')
  })

  it('does not echo an illegal URL or secrets in the response', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://user:url-secret@haven.example')
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'gateway-secret')

    const response = await GET(
      new NextRequest('https://dashboard.example/api/gateway/api/config'),
      { params: Promise.resolve({ path: ['api', 'config'] }) },
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).not.toContain('url-secret')
    expect(body).not.toContain('gateway-secret')
  })

  it('redacts the server token if an upstream error echoes it', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.example')
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'echoed-gateway-secret')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'bad authorization: echoed-gateway-secret',
      { status: 401 },
    )))

    const response = await GET(
      new NextRequest('https://dashboard.example/api/gateway/api/config'),
      { params: Promise.resolve({ path: ['api', 'config'] }) },
    )
    const body = await response.text()

    expect(response.status).toBe(401)
    expect(body).toContain('[REDACTED]')
    expect(body).not.toContain('echoed-gateway-secret')
  })
})
