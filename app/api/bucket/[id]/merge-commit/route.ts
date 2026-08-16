import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../../../lib/api'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const into = searchParams.get('into') || ''
  try {
    const body = await req.json()
    const cookie = await getSessionCookie()
    const res = await fetch(`${getHavenBaseUrl()}/api/bucket/${id}/merge-commit?into=${into}`, {
      method: 'POST',
      headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
