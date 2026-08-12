import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../lib/api'

async function relay(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const cookie = await getSessionCookie()
    const body = req.method === 'PATCH' ? await req.text() : undefined
    const res = await fetch(`${BASE_URL}/api/journal/${encodeURIComponent(id)}`, {
      method: req.method,
      headers: {
        Cookie: cookie,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error ?? '日记操作失败' }, { status: res.status })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export const GET = relay
export const PATCH = relay

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return relay(req, context)
}
