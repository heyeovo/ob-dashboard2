import { afterEach, describe, expect, it } from 'vitest'

import {
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  createDashboardSession,
  getDashboardAuthConfig,
  safeNextPath,
  verifyDashboardSession,
  verifyLoginSecret,
} from '@/app/lib/dashboardAuth'
import {
  loginRetryAfterSeconds,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimitForTests,
} from '@/app/lib/loginRateLimit'

const LOGIN_SECRET = 'test-login-passphrase-only'
const SESSION_SECRET = 'test-session-signing-secret-32-bytes-minimum'

afterEach(() => resetLoginRateLimitForTests())

describe('Dashboard auth primitives', () => {
  it('fails closed in production unless both strong secrets are configured', () => {
    expect(getDashboardAuthConfig({ NODE_ENV: 'production' })).toMatchObject({
      enabled: true,
      configured: false,
    })
    expect(getDashboardAuthConfig({
      NODE_ENV: 'production',
      DASHBOARD_LOGIN_SECRET: LOGIN_SECRET,
    }).configured).toBe(false)
    expect(getDashboardAuthConfig({
      NODE_ENV: 'production',
      OB2_LAN_SECRET: LOGIN_SECRET,
      DASHBOARD_SESSION_SECRET: SESSION_SECRET,
    }).configured).toBe(false)
    expect(getDashboardAuthConfig({
      NODE_ENV: 'production',
      DASHBOARD_LOGIN_SECRET: LOGIN_SECRET,
      DASHBOARD_SESSION_SECRET: SESSION_SECRET,
    })).toMatchObject({ enabled: true, configured: true, production: true })
  })

  it('keeps unconfigured dev open and supports the legacy dev password without storing it in a session', () => {
    expect(getDashboardAuthConfig({ NODE_ENV: 'development' })).toMatchObject({
      enabled: false,
      configured: false,
    })
    const configured = getDashboardAuthConfig({
      NODE_ENV: 'development',
      OB2_LAN_SECRET: LOGIN_SECRET,
    })
    expect(configured).toMatchObject({ enabled: true, configured: true, loginSecret: LOGIN_SECRET })
    expect(configured.sessionSecret).not.toContain(LOGIN_SECRET)
  })

  it('compares login input and verifies only authentic, unexpired sessions', () => {
    const now = Date.UTC(2026, 7, 17, 0, 0, 0)
    expect(verifyLoginSecret(LOGIN_SECRET, LOGIN_SECRET)).toBe(true)
    expect(verifyLoginSecret('wrong-password', LOGIN_SECRET)).toBe(false)

    const session = createDashboardSession(SESSION_SECRET, now)
    expect(session.token).not.toContain(LOGIN_SECRET)
    expect(session.token).not.toContain(SESSION_SECRET)
    expect(verifyDashboardSession(session.token, SESSION_SECRET, now)).toBe(true)
    expect(verifyDashboardSession(`${session.token.slice(0, -1)}x`, SESSION_SECRET, now)).toBe(false)
    expect(verifyDashboardSession(session.token, `${SESSION_SECRET}-rotated`, now)).toBe(false)
    expect(verifyDashboardSession(
      session.token,
      SESSION_SECRET,
      now + (DASHBOARD_SESSION_MAX_AGE_SECONDS + 1) * 1000,
    )).toBe(false)
  })

  it('accepts only local return paths and strips the retired k query', () => {
    expect(safeNextPath('/cc?tab=tools')).toBe('/cc?tab=tools')
    expect(safeNextPath('/memory?k=retired&bucket=1')).toBe('/memory?bucket=1')
    expect(safeNextPath('https://evil.example/')).toBe('/')
    expect(safeNextPath('//evil.example/')).toBe('/')
    expect(safeNextPath('/api/auth/logout')).toBe('/')
  })
})

describe('single-instance login throttling', () => {
  it('applies exponential client backoff and clears it after success', () => {
    const now = 1_000_000
    expect(loginRetryAfterSeconds('client-a', now)).toBe(0)
    expect(recordLoginFailure('client-a', now)).toBe(1)
    expect(loginRetryAfterSeconds('client-a', now)).toBe(1)
    expect(loginRetryAfterSeconds('client-a', now + 1001)).toBe(0)
    expect(recordLoginFailure('client-a', now + 1001)).toBe(2)
    expect(loginRetryAfterSeconds('client-a', now + 1001)).toBe(2)
    recordLoginSuccess('client-a')
    expect(loginRetryAfterSeconds('client-a', now + 1001)).toBe(0)
  })

  it('adds a global block after repeated failures even when client keys rotate', () => {
    const now = 2_000_000
    for (let index = 0; index < 20; index += 1) {
      recordLoginFailure(`client-${index}`, now + index)
    }
    expect(loginRetryAfterSeconds('new-client', now + 20)).toBe(60)
  })
})
