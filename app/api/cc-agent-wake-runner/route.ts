import { timingSafeEqual } from 'node:crypto'
import { runBackgroundWake, type BackgroundWakeCause } from '@/app/lib/cc/backgroundWakeTurn'

export const runtime = 'nodejs'
export const maxDuration = 360

const CAUSES = new Set<BackgroundWakeCause>(['cache_keepalive', 'agent_schedule', 'conversation_silence'])

function secureMatch(actual: string, expected: string) {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearer(request: Request) {
  const value = request.headers.get('authorization') || ''
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''
}

export async function POST(request: Request) {
  const expected = process.env.OMBRE_AGENT_WAKE_RUNNER_TOKEN?.trim() || ''
  if (!expected) return Response.json({ status: 'failed', error: 'wake_runner_not_configured' }, { status: 503 })
  if (!secureMatch(bearer(request), expected)) {
    return Response.json({ status: 'failed', error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return Response.json({ status: 'failed', error: 'invalid_json' }, { status: 400 })
  }
  const wakeId = String(body.wake_id || '').trim()
  const sessionId = String(body.session_id || '').trim()
  const laneId = String(body.lane_id || '').trim()
  const leaseOwner = String(body.lease_owner || '').trim()
  const cause = String(body.cause || '') as BackgroundWakeCause
  const dueAt = String(body.due_at || '').trim()
  const scheduleVersion = Number(body.schedule_version)
  if (
    !/^wake_[a-f0-9]{32}$/.test(wakeId) || !sessionId || sessionId.length > 200 ||
    !laneId || laneId.length > 200 || !leaseOwner || leaseOwner.length > 300 ||
    !CAUSES.has(cause) || !Number.isInteger(scheduleVersion) || scheduleVersion < 1 ||
    !dueAt || Number.isNaN(Date.parse(dueAt))
  ) {
    return Response.json({ status: 'failed', error: 'invalid_input' }, { status: 400 })
  }

  const result = await runBackgroundWake({
    sessionId,
    wakeId,
    at: new Date(dueAt).toISOString(),
    cause,
    reason: String(body.reason || '').trim().slice(0, 90),
    laneId,
    scheduleVersion,
    leaseOwner,
    silenceSourceTurnId: Number(body.silence_source_turn_id || 0),
  })
  if (result.status === 'completed') {
    return Response.json({ status: 'completed', turn_id: result.turnId, replayed: result.replayed === true })
  }
  if (result.status === 'failed') return Response.json(result)
  return Response.json(result)
}
