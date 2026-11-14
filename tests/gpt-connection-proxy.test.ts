import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/gpt-subscription/[operation]/route'
import { createDashboardSession, DASHBOARD_SESSION_COOKIE } from '@/app/lib/dashboardAuth'
import { config, proxy } from '../proxy'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'

const LOGIN = 'synthetic-login-passphrase'
const SESSION = 'synthetic-session-signing-secret-at-least-32-characters'
const BEARER = 'synthetic-gateway-bearer-never-for-browser'
const ACCESS = 'sk-synthetic-access-token'
const REFRESH = 'rt-synthetic-refresh-token'
let fetcher: ReturnType<typeof vi.fn>
function request(operation: string, body?: unknown, authenticated = true) {
  const cookie = authenticated ? `${DASHBOARD_SESSION_COOKIE}=${createDashboardSession(SESSION).token}` : ''
  return new NextRequest(`https://dashboard.test/api/gpt-subscription/${operation}?ignored=browser-query`, {
    method: body === undefined ? 'GET' : 'POST', headers: { cookie, Authorization: 'Bearer browser-supplied',
      'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
}
async function invoke(operation: string, body?: unknown, authenticated = true) {
  const req = request(operation, body, authenticated)
  const gate = proxy(req)
  if (gate.status !== 200) return gate
  return (body === undefined ? GET : POST)(req, { params: Promise.resolve({ operation }) })
}
function upstream(value: unknown, status = 200) {
  fetcher.mockResolvedValueOnce(Response.json(value, { status, headers: { Authorization: `Bearer ${BEARER}`,
    'Set-Cookie': `refresh_token=${REFRESH}`, 'X-Access-Token': ACCESS } }))
}
function connected(extra: Record<string, unknown> = {}) {
  return { ok: true, configured: true, status: 'connected', sharing: true, connection_id: 'connection-1',
    label: '我的授权', account: 'private@example.test', ...extra }
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('DASHBOARD_LOGIN_SECRET', LOGIN)
  vi.stubEnv('DASHBOARD_SESSION_SECRET', SESSION)
  vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.test')
  vi.stubEnv('OMBRE_GATEWAY_TOKEN', BEARER)
  fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('browser GPT connection proxy', () => {
  it('all three endpoints are Cookie protected before any upstream request', async () => {
    for (const operation of ['connection', 'connections', 'models']) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `/api/gpt-subscription/${operation}` })).toBe(true)
      expect((await invoke(operation, undefined, false)).status).toBe(401)
    }
    expect((await invoke('connection', { action: 'disconnect' }, false)).status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('fails closed with unconfigured production login and honors read-only preview', async () => {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', '')
    expect((await invoke('connection')).status).toBe(503)
    vi.stubEnv('DASHBOARD_SESSION_SECRET', SESSION)
    vi.stubEnv('DASHBOARD_PREVIEW_READ_ONLY', '1')
    expect((await invoke('connection', { action: 'disconnect' })).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses only server Bearer and whitelists/remasks state, never cookies, tokens or upstream headers', async () => {
    upstream(connected({ access_token: ACCESS, refresh_token: REFRESH, authorization: BEARER,
      identity: { email: 'private@example.test', access_token: ACCESS }, limits: { remaining: 999 },
      usage_url: `https://attacker.test/?token=${ACCESS}` }))
    const response = await invoke('connection')
    const value = await response.json()
    expect(value.account).toBe('p***')
    expect(value.limits).toBeNull()
    expect(value.usage_url).toBe('https://chatgpt.com/settings/usage')
    expect(value.connection_id).toBe('connection-1')
    const wire = JSON.stringify(value) + JSON.stringify([...response.headers])
    for (const secret of [ACCESS, REFRESH, BEARER, 'private@example.test']) expect(wire).not.toContain(secret)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://haven.test/gateway/api/gpt-subscription/connection')
    expect(options.headers.Authorization).toBe(`Bearer ${BEARER}`)
    expect(options.headers.Cookie).toBeUndefined()
    expect(options.headers.cookie).toBeUndefined()
  })
  it('projects connection list and model list to their fixed public fields', async () => {
    upstream({ ok: true, token: ACCESS, connections: [{ connection_id: 'connection-1', label: `我的 ${BEARER}`,
      status: 'reauth_required', sharing: false, refresh_token: REFRESH }] })
    const list = await (await invoke('connections')).json()
    expect(Object.keys(list.connections[0]).sort()).toEqual(['connection_id', 'label', 'sharing', 'status'])
    expect(JSON.stringify(list)).not.toContain(BEARER)
    expect(JSON.stringify(list)).not.toContain(REFRESH)
    upstream({ ok: true, models: [{ slug: 'gpt-test', displayName: 'GPT Test', api_key: ACCESS, raw: { token: REFRESH } }] })
    expect(await (await invoke('models')).json()).toEqual({ ok: true, models: [{ slug: 'gpt-test', displayName: 'GPT Test' }] })
  })
  it('accepts only exact select/disconnect operations without browser credentials', async () => {
    for (const body of [{ action: 'select', connection_id: 'connection-1' }, { action: 'disconnect' }]) {
      upstream(connected())
      expect((await invoke('connection', body)).status).toBe(200)
      expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toEqual(body)
    }
    expect(fetcher.mock.calls[0][1].method).toBe('POST')
  })
  it('represents a disabled integration without inventing connection or quota data', async () => {
    upstream({ ok: true, configured: false, status: 'disconnected', sharing: false, limits: null })
    const value = await (await invoke('connection')).json()
    expect(value.configured).toBe(false)
    expect(value.status).toBe('disconnected')
    expect(value.limits).toBeNull()
    expect(value.connection_id).toBeUndefined()
  })
  it('rejects invalid and oversized mutation bodies before calling Haven', async () => {
    for (const body of [null, [], { action: 'disconnect', extra: 'x' }, { action: 'select', connection_id: 'x'.repeat(5000) }]) {
      expect((await invoke('connection', body)).status).toBe(body && 'connection_id' in body ? 413 : 400)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects imports, arbitrary endpoints, unknown methods and credential/profile fields without forwarding', async () => {
    for (const body of [{ action: 'import', access_token: ACCESS }, { action: 'disconnect', refresh_token: REFRESH },
      { action: 'select', connection_id: 'connection-1', profile_id: 'other' }, { action: 'select', connection_id: '../escape' }]) {
      expect((await invoke('connection', body)).status).toBe(400)
    }
    expect((await invoke('models', { action: 'disconnect' })).status).toBe(405)
    expect((await invoke('connections', { action: 'disconnect' })).headers.get('allow')).toBe('GET')
    for (const endpoint of ['responses', 'cancel', 'chat-requests', 'import']) expect((await invoke(endpoint)).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves actionable errors and HTTP status while replacing arbitrary diagnostic text', async () => {
    upstream({ ok: false, error: { code: 'subscription_sharing_usage_limit_exceeded', action: 'usage_settings',
      message: `${ACCESS} ${REFRESH} Bearer ${BEARER}`, retryable: false, status: 429, responseShape: { token: ACCESS } } }, 429)
    const response = await invoke('models')
    const value = await response.json()
    expect(response.status).toBe(429)
    expect(value.error.code).toBe('subscription_sharing_usage_limit_exceeded')
    expect(value.error.action).toBe('usage_settings')
    expect(value.error.message).toContain('额度不足')
    for (const secret of [ACCESS, REFRESH, BEARER]) expect(JSON.stringify(value)).not.toContain(secret)
  })
  it('keeps nested reauth status errors masked and does not echo raw account data', async () => {
    upstream(connected({ status: 'reauth_required', error: { code: 'session_expired', action: 'reconnect', message: ACCESS },
      label: `account@example.test Bearer ${BEARER}` }))
    const value = await (await invoke('connection')).json()
    expect(value.error.action).toBe('reconnect')
    expect(value.label).not.toContain('@')
    expect(value.label).not.toContain(BEARER)
    expect(value.error.message).not.toContain(ACCESS)
  })
  it('fails safely on non-JSON errors, thrown errors or malformed successful data', async () => {
    fetcher.mockResolvedValueOnce(new Response(`Bearer ${BEARER} ${ACCESS}`, { status: 502 }))
    const response = await invoke('connection')
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain(BEARER)
    fetcher.mockRejectedValueOnce(new Error(`Authorization: Bearer ${BEARER}`))
    expect((await invoke('models')).status).toBe(502)
    upstream({ ok: true, models: [{ access_token: ACCESS }] })
    expect((await invoke('models')).status).toBe(502)
  })
})
