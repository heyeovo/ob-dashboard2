import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../lib/api'

async function relay(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  try {
    const cookie = await getSessionCookie()
    const body = req.method === 'GET' ? undefined : await req.text()
    const res = await fetch(`${BASE_URL}/api/journeys/${encodeURIComponent(id)}`, {
      method: req.method,
      headers: {
        Cookie: cookie,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })
    const responseBody = await res.text()
    const contentType = res.headers.get('content-type')
    return new NextResponse(responseBody, {
      status: res.status,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}

export const GET = relay
export const PATCH = relay
