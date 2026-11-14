import { NextRequest } from 'next/server'
import { gptError, parseGptRequest } from '@/app/lib/gptSubscription/contract'
import { getGptTurn, gptActiveTurn, startGptTurn, stopGptTurn } from '@/app/lib/gptSubscription/runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 1024 * 1024) return Response.json({ ok: false, error: gptError('', 'invalid_request', '请求过长') }, { status: 413 })
    const input = parseGptRequest(JSON.parse(raw))
    return await startGptTurn(input, request.signal)
  } catch {
    return Response.json({ ok: false, error: gptError('', 'invalid_request', '请求格式无效；GPT 首版仅支持文字闲聊，请检查发送标识、轮次及附件') }, { status: 400 })
  }
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  const requestId = request.nextUrl.searchParams.get('request_id') || ''
  const afterSeq = Number(request.nextUrl.searchParams.get('after_seq') || request.headers.get('Last-Event-ID') || 0)
  if (!sessionId || sessionId.length > 200 || (requestId && !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) || !Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }
  if (!requestId) return Response.json({ ok: true, active_turn: gptActiveTurn(sessionId) })
  try { return await getGptTurn(sessionId, requestId, request.signal, afterSeq) }
  catch { return Response.json({ ok: false, error: gptError(requestId, 'haven_read_failed', '无法核对请求状态，请稍后重试', 'preflight', true) }, { status: 502 }) }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.session_id !== 'string' || typeof body.request_id !== 'string') {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }
  const result = stopGptTurn(body.session_id, body.request_id)
  return Response.json(result, { status: result.ok ? 200 : 409 })
}
