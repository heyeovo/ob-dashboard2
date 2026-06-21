import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

// 把一个已有桶转为日记桶——不可逆，前端按钮需要二次确认
export async function POST(req: NextRequest) {
  try {
    const { id, author, locked, unlock_hint } = await req.json()
    if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/bucket/${id}/to-journal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ author, locked, unlock_hint }),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '转换失败' }, { status: res.status })
    return NextResponse.json({ ok: true, result: data })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
