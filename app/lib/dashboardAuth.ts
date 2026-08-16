import 'server-only'

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const DASHBOARD_SESSION_COOKIE = 'ob2_session'
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

const MIN_LOGIN_SECRET_LENGTH = 12
const MIN_SESSION_SECRET_LENGTH = 32

type AuthEnvironment = Record<string, string | undefined>

export type DashboardAuthConfig = {
  enabled: boolean
  configured: boolean
  production: boolean
  loginSecret: string
  sessionSecret: string
}

function trimmed(value: string | undefined): string {
  return (value || '').trim()
}

export function getDashboardAuthConfig(env: AuthEnvironment = process.env): DashboardAuthConfig {
  const production = env.NODE_ENV === 'production'
  const dashboardLoginSecret = trimmed(env.DASHBOARD_LOGIN_SECRET)
  const dashboardSessionSecret = trimmed(env.DASHBOARD_SESSION_SECRET)
  const legacyDevSecret = production ? '' : trimmed(env.OB2_LAN_SECRET)
  const loginSecret = dashboardLoginSecret || legacyDevSecret
  const sessionSecret = dashboardSessionSecret || (
    !production && loginSecret
      ? createHash('sha256').update(`ob2-development-session\0${loginSecret}`).digest('base64url')
      : ''
  )
  const enabled = production || Boolean(
    dashboardLoginSecret || dashboardSessionSecret || legacyDevSecret,
  )
  const configured = loginSecret.length >= MIN_LOGIN_SECRET_LENGTH
    && sessionSecret.length >= MIN_SESSION_SECRET_LENGTH

  return { enabled, configured, production, loginSecret, sessionSecret }
}

export function verifyLoginSecret(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateDigest, expectedDigest)
}

function signPayload(payload: string, sessionSecret: string): Buffer {
  return createHmac('sha256', sessionSecret)
    .update('ob2-dashboard-session-v1\0')
    .update(payload)
    .digest()
}

export function createDashboardSession(
  sessionSecret: string,
  nowMs = Date.now(),
): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(nowMs / 1000)
  const expiresAtSeconds = issuedAt + DASHBOARD_SESSION_MAX_AGE_SECONDS
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iat: issuedAt,
    exp: expiresAtSeconds,
    nonce: randomBytes(18).toString('base64url'),
  })).toString('base64url')
  const signature = signPayload(payload, sessionSecret).toString('base64url')

  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000),
  }
}

export function verifyDashboardSession(
  token: string | undefined,
  sessionSecret: string,
  nowMs = Date.now(),
): boolean {
  if (!token || !sessionSecret || token.length > 2048) return false
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false

  try {
    const suppliedSignature = Buffer.from(parts[1], 'base64url')
    const expectedSignature = signPayload(parts[0], sessionSecret)
    if (
      suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return false

    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      v?: unknown
      iat?: unknown
      exp?: unknown
      nonce?: unknown
    }
    const nowSeconds = Math.floor(nowMs / 1000)
    return payload.v === 1
      && Number.isInteger(payload.iat)
      && Number.isInteger(payload.exp)
      && typeof payload.nonce === 'string'
      && payload.nonce.length >= 16
      && Number(payload.iat) <= nowSeconds + 60
      && Number(payload.exp) > nowSeconds
      && Number(payload.exp) - Number(payload.iat) <= DASHBOARD_SESSION_MAX_AGE_SECONDS
  } catch {
    return false
  }
}

export function dashboardSessionCookieOptions(production: boolean, expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'strict' as const,
    path: '/',
    ...(expiresAt
      ? { expires: expiresAt, maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS }
      : {}),
  }
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  try {
    const parsed = new URL(value, 'https://dashboard.invalid')
    if (parsed.origin !== 'https://dashboard.invalid') return '/'
    parsed.searchParams.delete('k')
    const result = `${parsed.pathname}${parsed.search}${parsed.hash}`
    if (
      result.length > 1500
      || parsed.pathname === '/login'
      || parsed.pathname.startsWith('/api/auth/')
    ) return '/'
    return result
  } catch {
    return '/'
  }
}
