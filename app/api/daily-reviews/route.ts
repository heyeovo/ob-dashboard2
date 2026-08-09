import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

async function relay(response: Response) {
  const body = await response.text()
  return new NextResponse(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
  })
}

export async function GET(request: NextRequest) {
  try {
    const cookie = await getSessionCookie()
    const params = new URLSearchParams(request.nextUrl.searchParams)
    const response = await fetch(`${BASE_URL}/api/daily-reviews?${params.toString()}`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
    })
    return relay(response)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const cookie = await getSessionCookie()
    const body = await request.text()
    const response = await fetch(`${BASE_URL}/api/daily-reviews`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body,
    })
    return relay(response)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}
