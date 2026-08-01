import { NextRequest } from 'next/server'
import {
  createSelfhostStream,
  prepareSelfhostTurn,
  sseResponse,
  type SelfhostRequest,
} from '@/app/lib/selfhost/runSelfhostTurn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function invalid(message: string, requestId = ''): Response {
  return Response.json({
    ok: false,
    error: {
      code: 'invalid_request',
      message,
      stage: 'preflight',
      retryable: false,
      http_status: 400,
      request_id: requestId,
      generated_not_saved: false,
    },
  }, { status: 400 })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return invalid('请求体不是 JSON')
  }
  const parsed: SelfhostRequest = {
    sessionId: String(body.session_id || '').trim(),
    requestId: String(body.request_id || '').trim(),
    personaId: String(body.persona_id || '').trim(),
    text: String(body.text || ''),
    expectedLastRoundId: Number(body.expected_last_round_id),
  }
  if (!parsed.sessionId) return invalid('session_id 不能为空', parsed.requestId)
  if (!parsed.requestId) return invalid('request_id 不能为空')
  if (parsed.requestId.length > 128) return invalid('request_id 不能超过 128 个字符', parsed.requestId)
  if (!parsed.personaId) return invalid('persona_id 不能为空', parsed.requestId)
  if (!parsed.text.trim()) return invalid('text 不能为空', parsed.requestId)
  if (!Number.isInteger(parsed.expectedLastRoundId) || parsed.expectedLastRoundId < 0) {
    return invalid('expected_last_round_id 必须是大于或等于 0 的整数', parsed.requestId)
  }

  const prepared = await prepareSelfhostTurn(parsed, request.signal)
  if (prepared.kind === 'error') {
    return Response.json({ ok: false, error: prepared.error }, { status: prepared.status })
  }
  return sseResponse(createSelfhostStream(prepared, request.signal))
}

