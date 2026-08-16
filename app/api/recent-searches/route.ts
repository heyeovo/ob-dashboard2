import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = searchParams.get('limit') || '20'

  try {
    const cookie = await getSessionCookie()
    const params = new URLSearchParams({ limit })
    const res = await fetch(`${getHavenBaseUrl()}/api/recent-searches?${params}`, {
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
