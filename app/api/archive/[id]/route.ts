import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../lib/api'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params   // ← 加 await
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/archive/${id}`, {  // ← 用 id
      method: 'POST',
      headers: { Cookie: cookie },
    })
    return NextResponse.json(await res.json())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}