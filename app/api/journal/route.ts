import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

export async function GET() {
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/journal`, { headers: { Cookie: cookie } })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '读取失败' }, { status: res.status })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/journal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '创建失败' }, { status: res.status })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
