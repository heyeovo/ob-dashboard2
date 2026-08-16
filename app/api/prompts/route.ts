import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

export async function GET() {
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/prompts`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/prompts`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
