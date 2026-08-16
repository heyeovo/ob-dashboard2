import { NextRequest } from 'next/server'
import {
  getHavenGatewayConnection,
  HavenConfigurationError,
  joinHavenUrl,
  redactHavenSecrets,
} from '@/app/lib/havenConfig'

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
    const { baseUrl, token } = getHavenGatewayConnection()
    const sessionId = req.headers.get('x-ombre-session-id') || 'main'
    const backendUrl = `${joinHavenUrl(baseUrl, `/gateway/${subpath}`)}${req.nextUrl.search}`

    const headers: Record<string, string> = {
      'X-Ombre-Session-Id': sessionId,
      Authorization: `Bearer ${token}`,
    }
    const skipHandoff = req.headers.get('x-ombre-skip-handoff')
    if (skipHandoff) headers['X-Ombre-Skip-Handoff'] = skipHandoff
    const forceHandoff = req.headers.get('x-ombre-force-handoff')
    if (forceHandoff) headers['X-Ombre-Force-Handoff'] = forceHandoff
    const handoffBuckets = req.headers.get('x-ombre-handoff-buckets')
    if (handoffBuckets) headers['X-Ombre-Handoff-Buckets'] = handoffBuckets
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
      return new Response(redactHavenSecrets(errText), { status: upstreamRes.status })
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
    const configurationError = e instanceof HavenConfigurationError
    return new Response(
      JSON.stringify({
        error: configurationError
          ? e.message
          : 'Gateway proxy failed',
      }),
      { status: configurationError ? 503 : 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
