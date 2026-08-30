import { NextRequest } from 'next/server'
import { ccLaneId } from '@/app/lib/cc/ccOptions'
import { getExactContextAnalysis } from '@/app/lib/ccSession'
import type { CredMode } from '@/app/lib/ccEnv'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sessionId = String(body.session_id || '').trim()
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  const cred: CredMode = body.cred === 'api' ? 'api' : 'subscription'
  const providerId = String(body.provider_id || '').trim()
  const result = await getExactContextAnalysis({
    sessionId,
    laneId: ccLaneId(cred, providerId),
    force: body.force === true,
  })
  return Response.json(result, { status: result.ok ? 200 : 409 })
}
