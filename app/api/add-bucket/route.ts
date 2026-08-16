import { NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

// 新增记忆——原来走 MCP hold 工具，现在改用 REST POST /api/bucket
export async function POST(req: Request) {
  try {
    const { content, tags, importance, valence, arousal } = await req.json()
    const cookie = await getSessionCookie()
    const body: Record<string, unknown> = { content, tags, importance: Number(importance) }
    if (valence !== undefined) body.valence = Number(valence)
    if (arousal !== undefined) body.arousal = Number(arousal)
    const res = await fetch(`${getHavenBaseUrl()}/api/bucket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '创建失败' }, { status: res.status })
    return NextResponse.json({ ok: true, result: data })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
