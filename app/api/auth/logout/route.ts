import { NextRequest, NextResponse } from 'next/server'

import {
  DASHBOARD_SESSION_COOKIE,
  dashboardSessionCookieOptions,
  getDashboardAuthConfig,
} from '@/app/lib/dashboardAuth'

export async function POST(request: NextRequest) {
  const auth = getDashboardAuthConfig()
  const destination = auth.enabled ? '/login?logged_out=1' : '/'
  const response = NextResponse.redirect(new URL(destination, request.url), 303)
  response.cookies.set(DASHBOARD_SESSION_COOKIE, '', {
    ...dashboardSessionCookieOptions(auth.production),
    expires: new Date(0),
    maxAge: 0,
  })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Clear-Site-Data', '"cache"')
  return response
}
