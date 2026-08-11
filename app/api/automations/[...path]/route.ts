import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../../lib/api'

const ALLOWED_PATHS = [
  /^status$/,
  /^weekly-journey\/run$/,
  /^candidates$/,
  /^candidates\/[A-Za-z0-9_-]+$/,
  /^candidates\/[A-Za-z0-9_-]+\/(reject|confirm)$/,
]

function isAllowedPath(path: string) {
  return ALLOWED_PATHS.some(pattern => pattern.test(path))
}

async function relay(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const upstreamPath = path.map(decodeURIComponent).join('/')
  if (!isAllowedPath(upstreamPath)) {
    return NextResponse.json({ error: 'Unsupported automation endpoint' }, { status: 404 })
  }

  try {
    const cookie = await getSessionCookie()
    const body = request.method === 'GET' ? undefined : await request.text()
    const response = await fetch(
      `${BASE_URL}/api/automations/${upstreamPath}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        cache: 'no-store',
      },
    )
    const responseBody = await response.text()
    const contentType = response.headers.get('content-type')
    return new NextResponse(responseBody, {
      status: response.status,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}

export const GET = relay
export const POST = relay
export const PATCH = relay
