import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../lib/api'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/journal/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '删除失败' }, { status: res.status })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
