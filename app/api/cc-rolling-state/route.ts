import { NextRequest } from 'next/server'
import { ccLaneId } from '@/app/lib/cc/ccOptions'
import { getConversationSession, getRollingSeedReceipt } from '@/app/lib/havenTurns'

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get('session_id') || '').trim()
  if (!id) return Response.json({ ok: false }, { status: 400 })
  const result = await getConversationSession(id)
  if (!result.ok || !result.session) return Response.json({ ok: false }, { status: 502 })
  const session = result.session
  const cred = session.cc_overrides?.active_cred === 'subscription' ? 'subscription' : 'api'
  const lane = ccLaneId(cred, cred === 'api' ? String(session.cc_overrides?.api?.provider_id || '') : '')
  const nativeSessionId = String(session.cc_lanes?.[lane]?.cc_session_id || '')
  const receipt = await getRollingSeedReceipt(id, nativeSessionId)
  return Response.json({ ok: true, revision: session.context_revision,
    days: receipt?.contextRevision === session.context_revision && receipt.newSessionId === nativeSessionId && Array.isArray(receipt.days) ? receipt.days : null })
}
