import { NextRequest, NextResponse } from 'next/server'

const BASE_URL = process.env.OMBRE_BASE_URL || process.env.NEXT_PUBLIC_OMBRE_BASE_URL!
const PASSWORD = process.env.OMBRE_SESSION || process.env.NEXT_PUBLIC_OMBRE_SESSION!

async function getSessionCookie() {
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params   // ← 加 await
    const cookie = await getSessionCookie()
    const res = await fetch(`${BASE_URL}/api/touch/${id}`, {  // ← 用 id
      method: 'POST',
      headers: { Cookie: cookie },
    })
    return NextResponse.json(await res.json())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}