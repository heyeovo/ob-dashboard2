import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

const ALLOWED_PARAMS = new Set(['conversation_id', 'source', 'q', 'limit', 'offset'])

export async function GET(req: NextRequest) {
  const incoming = req.nextUrl.searchParams
  const params = new URLSearchParams()
  incoming.forEach((value, key) => {
    if (ALLOWED_PARAMS.has(key)) params.set(key, value)
  })
  const endpoint = params.has('conversation_id')
    ? 'raw-conversation-events'
    : 'raw-conversations'

  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/${endpoint}?${params.toString()}`, {
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
