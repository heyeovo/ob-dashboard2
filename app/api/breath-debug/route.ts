import { NextRequest, NextResponse } from 'next/server'

const BASE_URL = process.env.OMBRE_BASE_URL || process.env.NEXT_PUBLIC_OMBRE_BASE_URL!
const PASSWORD = process.env.OMBRE_SESSION || process.env.NEXT_PUBLIC_OMBRE_SESSION!

async function getSessionCookie(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!res.ok) throw new Error('登录失败')
  const cookie = res.headers.get('set-cookie')
  if (!cookie) throw new Error('未收到 Cookie')
  return cookie
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const valence = searchParams.get('valence') || ''
  const arousal = searchParams.get('arousal') || ''

  try {
    const cookie = await getSessionCookie()
    const params = new URLSearchParams({ q })
    if (valence) params.set('valence', valence)
    if (arousal) params.set('arousal', arousal)

    const res = await fetch(`${BASE_URL}/api/breath-debug?${params}`, {
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
