import { NextRequest, NextResponse } from 'next/server'
import {
  getAgentWakeSchedule,
  patchAgentWakeSchedule,
} from '@/app/lib/havenTurns'

export const runtime = 'nodejs'

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function GET(request: NextRequest) {
  const sessionId = String(request.nextUrl.searchParams.get('session_id') || '').trim()
  const laneId = String(request.nextUrl.searchParams.get('lane_id') || '').trim()
  if (!sessionId || !laneId) return error('缺少 session_id / lane_id')
  const result = await getAgentWakeSchedule(sessionId, laneId)
  return result.ok
    ? NextResponse.json({ ok: true, schedule: result.schedule })
    : error(result.error || '读取主动唤醒设置失败', result.httpStatus || 502)
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sessionId = String(body?.session_id || '').trim()
  const laneId = String(body?.lane_id || '').trim()
  const action = String(body?.action || 'update')
  if (!sessionId || !laneId) return error('缺少 session_id / lane_id')

  let changes = body?.changes && typeof body.changes === 'object'
    ? { ...(body.changes as Record<string, unknown>) }
    : {}
  if (action === 'cancel_next') changes = { next_agent_wake_at: '', wake_reason: '' }
  if (action === 'stop_all') {
    changes = {
      keepalive_enabled: false,
      keepalive_paused_until_user: false,
      agent_wake_enabled: false,
      conversation_silence_enabled: false,
      next_agent_wake_at: '',
      wake_reason: '',
      conversation_silence_check_at: '',
      silence_source_turn_id: 0,
      silence_policy_version: '',
    }
  }
  if (Object.keys(changes).length === 0) return error('没有可保存的主动唤醒设置')
  const result = await patchAgentWakeSchedule({
    sessionId,
    laneId,
    expectedVersion: body?.expected_version == null ? undefined : Number(body.expected_version),
    changes,
  })
  return result.ok
    ? NextResponse.json({ ok: true, schedule: result.schedule })
    : error(result.error || '保存主动唤醒设置失败', result.httpStatus || 502)
}
