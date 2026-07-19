import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const endpoint = String(payload.endpoint || '').trim()
    const relayHeaders: Record<string, string> = {}

    if (payload.headers && typeof payload.headers === 'object') {
      for (const [k, v] of Object.entries(payload.headers)) {
        relayHeaders[k] = String(v)
      }
    }

    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'Missing upstream endpoint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    delete relayHeaders['host']
    delete relayHeaders['connection']
    delete relayHeaders['transfer-encoding']

    const upstreamRes = await fetch(endpoint, {
      method: 'POST',
      headers: { ...relayHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body ?? {}),
    })

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Provider relay failed', detail: String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      'Access-Control-Max-Age': '86400',
    },
  })
}
