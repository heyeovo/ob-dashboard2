import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

export async function GET(request: NextRequest) {
  try {
    const cookie = await getSessionCookie()
    const response = await fetch(`${BASE_URL}/api/persona${request.nextUrl.search}`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
    })
    const body = await response.text()
    const contentType = response.headers.get('content-type')
    return new NextResponse(body, {
      status: response.status,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}
