import { NextRequest } from 'next/server'
import { getTurnBroadcast, turnStream } from '@/app/lib/cc/turnBroadcast'

export const runtime = 'nodejs'

export function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  const requestId = request.nextUrl.searchParams.get('request_id') || ''
  const afterSeq = Number(request.nextUrl.searchParams.get('after_seq') || 0)
  if (!sessionId || !requestId || !Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400 })
  }
  const turn = getTurnBroadcast(sessionId, requestId)
  if (!turn) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 })
  if (turn.truncated) return Response.json({ ok: false, reason: 'truncated' }, { status: 409 })
  return turnStream(turn, request.signal, afterSeq)
}
