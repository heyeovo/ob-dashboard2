import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../lib/api'

const ALLOWED_PATH = /^(reminders|todos)(\/[^/]+)?$/

async function relay(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const upstreamPath = path.map(decodeURIComponent).join('/')
  if (!ALLOWED_PATH.test(upstreamPath)) {
    return NextResponse.json({ error: 'Unsupported care endpoint' }, { status: 404 })
  }

  try {
    const cookie = await getSessionCookie()
    const query = req.nextUrl.search
    const body = req.method === 'GET' ? undefined : await req.text()
    const res = await fetch(`${BASE_URL}/api/${upstreamPath}${query}`, {
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
export const POST = relay
export const PATCH = relay
