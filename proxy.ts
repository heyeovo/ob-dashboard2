import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardAuthConfig,
  safeNextPath,
  verifyDashboardSession,
} from './app/lib/dashboardAuth'

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/health',
  '/api/automation-pro-runner',
  '/api/cc-agent-wake-runner',
  '/favicon.ico',
  '/manifest.json',
  '/ob-icon-192.png',
  '/ob-icon-512.png',
  '/sw.js',
])

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function isApi(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

function isAuthenticated(request: NextRequest, sessionSecret: string): boolean {
  return verifyDashboardSession(
    request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value,
    sessionSecret,
  )
}

function unavailable(request: NextRequest): NextResponse {
  if (isApi(request.nextUrl.pathname)) {
    return noStore(NextResponse.json(
      { ok: false, error: 'Dashboard 登录尚未安全配置。' },
      { status: 503 },
    ))
  }
  return noStore(new NextResponse(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<div style="font:15px/1.7 system-ui;max-width:24rem;margin:16vh auto;padding:0 1.5rem;color:#3a3734">'
      + '<b style="font-size:17px">Dashboard 暂未开放</b>'
      + '<p style="color:#7a7570">服务端登录配置不完整。为保护私人数据，当前拒绝访问。</p></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  ))
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const auth = getDashboardAuthConfig()

  if (path === '/login' && !auth.enabled) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (
    path === '/login'
    && auth.configured
    && isAuthenticated(request, auth.sessionSecret)
  ) {
    return noStore(NextResponse.redirect(new URL(
      safeNextPath(request.nextUrl.searchParams.get('next')),
      request.url,
    )))
  }
  if (PUBLIC_PATHS.has(path)) {
    return path === '/login' ? noStore(NextResponse.next()) : NextResponse.next()
  }

  // Local `npm run dev` keeps its no-configuration fallback. Production is always enabled.
  if (!auth.enabled) return NextResponse.next()
  if (!auth.configured) return unavailable(request)
  if (isAuthenticated(request, auth.sessionSecret)) return NextResponse.next()

  if (isApi(path)) {
    return noStore(NextResponse.json(
      { ok: false, error: '请先登录 Dashboard。' },
      { status: 401 },
    ))
  }

  const loginUrl = new URL('/login', request.url)
  const requested = safeNextPath(`${path}${request.nextUrl.search}`)
  if (requested !== '/') loginUrl.searchParams.set('next', requested)
  return noStore(NextResponse.redirect(loginUrl))
}

export const config = {
  // Auth runs for every route except immutable Next.js build assets. Public files are exact allowlist entries above.
  matcher: ['/((?!_next/static/).*)'],
}
