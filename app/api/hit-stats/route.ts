import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = searchParams.get('limit') || '50'
  const include_zero = searchParams.get('include_zero') || 'false'
  const order = searchParams.get('order') || 'desc'
  const exclude_gated = searchParams.get('exclude_gated') || 'true'

  try {
    const cookie = await getSessionCookie()
    const params = new URLSearchParams({ limit, include_zero, order, exclude_gated })
    const res = await fetch(`${BASE_URL}/api/hit-stats?${params}`, {
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST() {
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/hit-stats/reset`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
