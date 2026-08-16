import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

// 编辑/删除桶——原来走 MCP trace 工具，现在改用 REST：
// 普通字段更新 → PATCH /api/bucket/{id}，硬删除 → DELETE /api/bucket/{id}
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, delete: del, ...fields } = body

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  try {
    const cookie = await getSessionCookie()

    if (del) {
      const res = await fetch(`${getHavenBaseUrl()}/api/bucket/${id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      })
      const data = await res.json()
      if (!res.ok) return NextResponse.json({ error: data.error ?? '删除失败' }, { status: res.status })
      return NextResponse.json({ ok: true, result: data })
    }

    const res = await fetch(`${getHavenBaseUrl()}/api/bucket/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(fields),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '更新失败' }, { status: res.status })
    return NextResponse.json({ ok: true, result: data })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
