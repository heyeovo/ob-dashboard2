import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const valence = searchParams.get('valence') || ''
  const arousal = searchParams.get('arousal') || ''
  const threshold = searchParams.get('threshold') || ''

  try {
    const cookie = await getSessionCookie()
    const params = new URLSearchParams({ q })
    if (valence) params.set('valence', valence)
    if (arousal) params.set('arousal', arousal)
    if (threshold) params.set('threshold', threshold)

    const res = await fetch(`${BASE_URL}/api/breath-debug?${params}`, {
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
