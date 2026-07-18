import { NextRequest } from 'next/server'

const GATEWAY_URL = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const sessionId = req.headers.get('x-ombre-session-id') || 'main'

    const upstreamRes = await fetch(`${GATEWAY_URL}/gateway/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.headers.get('authorization') || ''}`,
        'X-Ombre-Session-Id': sessionId,
      },
      body,
    })

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text()
      return new Response(errText, { status: upstreamRes.status })
    }

    // Stream the SSE response back
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Gateway proxy failed', detail: String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
