import { NextRequest, NextResponse } from 'next/server'

import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSession,
  dashboardSessionCookieOptions,
  getDashboardAuthConfig,
  safeNextPath,
  verifyLoginSecret,
} from '@/app/lib/dashboardAuth'
import {
  loginClientKey,
  loginRetryAfterSeconds,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/app/lib/loginRateLimit'

function privateResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

function loginError(request: NextRequest, next: string, retryAfter: number): NextResponse {
  if ((request.headers.get('accept') || '').includes('application/json')) {
    const response = NextResponse.json(
      { ok: false, error: '登录口令不正确。', retry_after: retryAfter },
      { status: 401 },
    )
    response.headers.set('Retry-After', String(retryAfter))
    return privateResponse(response)
  }
  const url = new URL('/login', request.url)
  url.searchParams.set('error', 'invalid')
  if (next !== '/') url.searchParams.set('next', next)
  const response = NextResponse.redirect(url, 303)
  response.headers.set('Retry-After', String(retryAfter))
  return privateResponse(response)
}

export async function POST(request: NextRequest) {
  const auth = getDashboardAuthConfig()
  if (!auth.enabled) {
    return privateResponse(NextResponse.redirect(new URL('/', request.url), 303))
  }
  if (!auth.configured) {
    return privateResponse(NextResponse.json(
      { ok: false, error: 'Dashboard 登录尚未安全配置。' },
      { status: 503 },
    ))
  }

  const clientKey = loginClientKey(request.headers)
  const blockedFor = loginRetryAfterSeconds(clientKey)
  if (blockedFor > 0) {
    const response = NextResponse.json(
      { ok: false, error: '尝试过于频繁，请稍后再试。', retry_after: blockedFor },
      { status: 429 },
    )
    response.headers.set('Retry-After', String(blockedFor))
    return privateResponse(response)
  }

  let password = ''
  let next = '/'
  try {
    const form = await request.formData()
    const rawPassword = form.get('password')
    password = typeof rawPassword === 'string' && rawPassword.length <= 2048 ? rawPassword : ''
    next = safeNextPath(typeof form.get('next') === 'string' ? String(form.get('next')) : '/')
  } catch {
    // Treat malformed input exactly like an incorrect password.
  }

  if (!verifyLoginSecret(password, auth.loginSecret)) {
    return loginError(request, next, recordLoginFailure(clientKey))
  }

  recordLoginSuccess(clientKey)
  const session = createDashboardSession(auth.sessionSecret)
  const response = NextResponse.redirect(new URL(next, request.url), 303)
  response.cookies.set(
    DASHBOARD_SESSION_COOKIE,
    session.token,
    dashboardSessionCookieOptions(auth.production, session.expiresAt),
  )
  return privateResponse(response)
}
