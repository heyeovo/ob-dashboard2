import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../../lib/api'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/bucket/${id}/restore`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
