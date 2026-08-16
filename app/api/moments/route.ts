import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

export async function GET(req: NextRequest) {
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/moments${req.nextUrl.search}`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
    })
    const body = await res.text()
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}
