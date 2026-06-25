import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

export async function GET() {
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/import/status`, {
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
