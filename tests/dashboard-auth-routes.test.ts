import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { resetLoginRateLimitForTests } from '@/app/lib/loginRateLimit'

const LOGIN_SECRET = 'route-test-login-passphrase'
const SESSION_SECRET = 'route-test-session-signing-secret-at-least-32-bytes'
const ORIGINAL_ENV = { ...process.env }

function loginRequest(password: string, headers: Record<string, string> = {}) {
  return new NextRequest('https://dashboard.example/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body: new URLSearchParams({ password, next: '/cc?view=chat' }),
  })
}

beforeEach(() => {
  process.env.NODE_ENV = 'production'
  process.env.DASHBOARD_LOGIN_SECRET = LOGIN_SECRET
  process.env.DASHBOARD_SESSION_SECRET = SESSION_SECRET
  delete process.env.OB2_LAN_SECRET
  resetLoginRateLimitForTests()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

describe('Dashboard login/logout routes', () => {
  it('sets a hardened signed cookie after a correct POST login without leaking secrets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await login(loginRequest(LOGIN_SECRET))
    const serialized = `${response.headers}\n${await response.text()}`

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://dashboard.example/cc?view=chat')
    expect(response.headers.get('set-cookie')).toMatch(/ob2_session=[^;]+/)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=strict/i)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=604800')
    expect(serialized).not.toContain(LOGIN_SECRET)
    expect(serialized).not.toContain(SESSION_SECRET)
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('rejects a wrong password and throttles an immediate retry without echoing it', async () => {
    const wrong = 'wrong-password-from-test'
    const response = await login(loginRequest(wrong))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('/login?error=invalid')
    expect(`${response.headers}\n${await response.text()}`).not.toContain(wrong)

    const blocked = await login(loginRequest(wrong, { accept: 'application/json' }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('1')
    expect(await blocked.text()).not.toContain(wrong)
  })

  it('fails closed when either production secret is absent', async () => {
    delete process.env.DASHBOARD_SESSION_SECRET
    const response = await login(loginRequest(LOGIN_SECRET))
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).not.toContain(LOGIN_SECRET)
  })

  it('clears the session cookie and browser cache on logout', async () => {
    const response = await logout(new NextRequest('https://dashboard.example/api/auth/logout', {
      method: 'POST',
    }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://dashboard.example/login?logged_out=1')
    expect(response.headers.get('set-cookie')).toContain('ob2_session=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(response.headers.get('clear-site-data')).toBe('"cache"')
  })
})
