import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

async function relayResponse(res: Response) {
  const body = await res.text()
  const contentType = res.headers.get('content-type')

  return new NextResponse(body, {
    status: res.status,
    headers: contentType ? { 'Content-Type': contentType } : undefined,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/config`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return relayResponse(res)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

export async function GET() {
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/config`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
    })
    return relayResponse(res)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
