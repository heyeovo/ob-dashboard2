import { NextRequest } from 'next/server'

const GATEWAY_URL = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
)

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(req, path.join('/'), 'GET')
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  return proxy(req, path.join('/'), 'POST')
}

async function proxy(req: NextRequest, subpath: string, method: string) {
  try {
    const sessionId = req.headers.get('x-ombre-session-id') || 'main'
    const backendUrl = `${GATEWAY_URL}/gateway/${subpath}${req.nextUrl.search}`

    const headers: Record<string, string> = {
      'X-Ombre-Session-Id': sessionId,
    }
    const auth = req.headers.get('authorization')
    if (auth) headers['Authorization'] = auth
    const apiKey = req.headers.get('x-api-key')
    if (apiKey) headers['x-api-key'] = apiKey
    const ct = req.headers.get('content-type')
    if (ct) headers['Content-Type'] = ct

    const body = method === 'GET' ? undefined : await req.text()

    const upstreamRes = await fetch(backendUrl, {
      method,
      headers,
      body,
    })

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text()
      return new Response(errText, { status: upstreamRes.status })
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Gateway proxy failed', detail: String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
