import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

export const runtime = 'nodejs'

async function relay(response: Response) {
  const body = await response.text()
  return new NextResponse(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
  })
}

async function forward(request: NextRequest, method: 'GET' | 'POST' | 'PATCH') {
  try {
    const cookie = await getSessionCookie()
    const query = method === 'GET' ? `?${request.nextUrl.searchParams.toString()}` : ''
    const response = await fetch(`${getHavenBaseUrl()}/api/conversation-slices${query}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
      body: method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
    })
    return relay(response)
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return forward(request, 'GET')
}

export async function POST(request: NextRequest) {
  return forward(request, 'POST')
}

export async function PATCH(request: NextRequest) {
  return forward(request, 'PATCH')
}
