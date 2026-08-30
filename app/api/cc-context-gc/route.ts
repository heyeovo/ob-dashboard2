import { NextRequest, NextResponse } from 'next/server'
import { activateContextGcFork, prepareSessionForContextGc } from '@/app/lib/ccSession'
import { applyContextGc, scanContextGc } from '@/app/lib/contextGc'
import { getConversationSession, patchConversationContextGc } from '@/app/lib/havenTurns'

export const runtime = 'nodejs'
export const maxDuration = 120

function laneSessionId(lane: unknown): string {
  return lane && typeof lane === 'object'
    ? String((lane as Record<string, unknown>).cc_session_id || '').trim()
    : ''
}

async function load(sessionId: string, laneId: string) {
  const loaded = await getConversationSession(sessionId)
  if (!loaded.ok || !loaded.session) throw new Error(loaded.error || '找不到这个窗口')
  const ccSessionId = laneSessionId(loaded.session.cc_lanes?.[laneId])
  if (!ccSessionId) throw new Error('这条线路还没有可减负的 Claude 会话')
  return { session: loaded.session, ccSessionId }
}

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ ok: false, error: (error as Error).message || '窗口减负失败' }, { status })
}

export async function GET(request: NextRequest) {
  const sessionId = String(request.nextUrl.searchParams.get('session_id') || '').trim()
  const laneId = String(request.nextUrl.searchParams.get('lane_id') || '').trim()
  if (!sessionId || !laneId) return errorResponse(new Error('缺少 session_id / lane_id'))
  try {
    const { session, ccSessionId } = await load(sessionId, laneId)
    const gc = session.context_gc || {}
    const scan = await scanContextGc(ccSessionId, gc.protected_keys || [])
    return NextResponse.json({
      ok: true,
      lane_id: laneId,
      cc_session_id: ccSessionId,
      candidates: scan.candidates,
      estimated_tokens: scan.estimatedTokens,
      context_gc: {
        auto_enabled: gc.auto_enabled === true,
        schedule_time: '05:30',
        protected_keys: gc.protected_keys || [],
        history: gc.history || [],
        last_auto_date: gc.last_auto_date || '',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>
    const sessionId = String(body.session_id || '').trim()
    const loaded = await getConversationSession(sessionId)
    if (!loaded.ok || !loaded.session) throw new Error(loaded.error || '找不到这个窗口')
    const protectedKeys = Array.isArray(body.protected_keys) ? body.protected_keys.map(String) : undefined
    const autoEnabled = typeof body.auto_enabled === 'boolean' ? body.auto_enabled : undefined
    if (protectedKeys === undefined && autoEnabled === undefined) throw new Error('没有可保存的减负设置')
    const saved = await patchConversationContextGc({
      sessionId,
      personaId: loaded.session.persona_id,
      expectedStateVersion: loaded.session.state_version,
      preferences: {
        ...(protectedKeys !== undefined ? { protected_keys: protectedKeys } : {}),
        ...(autoEnabled !== undefined ? { auto_enabled: autoEnabled } : {}),
      },
    })
    if (!saved.ok) return errorResponse(new Error(saved.error || '保存失败'), saved.httpStatus || 400)
    return NextResponse.json({ ok: true, context_gc: saved.session?.context_gc || {} })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>
    const sessionId = String(body.session_id || '').trim()
    const laneId = String(body.lane_id || '').trim()
    const mode = body.mode === 'auto' ? 'auto' : 'manual'
    if (!sessionId || !laneId) throw new Error('缺少 session_id / lane_id')
    const { session, ccSessionId } = await load(sessionId, laneId)
    const scan = await scanContextGc(ccSessionId, session.context_gc?.protected_keys || [])
    const allowed = new Set(scan.candidates.filter(item => !item.protected).map(item => item.id))
    const selectedIds = mode === 'auto'
      ? [...allowed]
      : Array.isArray(body.selected_ids) ? body.selected_ids.map(String) : []
    if (selectedIds.some(id => !allowed.has(id))) throw new Error('选择内容已变化或已设为始终保留，请重新扫描')
    if (selectedIds.length === 0) throw new Error('没有选中可清理的内容')
    const ready = prepareSessionForContextGc(sessionId, laneId)
    if (!ready.ok) return errorResponse(new Error(ready.error), 409)

    const applied = await applyContextGc(ccSessionId, selectedIds)
    const committed = await patchConversationContextGc({
      sessionId,
      personaId: session.persona_id,
      expectedStateVersion: session.state_version,
      commit: {
        lane_id: laneId,
        expected_cc_session_id: ccSessionId,
        next_cc_session_id: applied.nextCcSessionId,
        released_tokens: applied.releasedTokens,
        candidate_count: applied.candidateCount,
        counts: applied.counts,
        mode,
        ...(mode === 'auto' ? { local_date: String(body.local_date || '') } : {}),
      },
    })
    if (!committed.ok) {
      return errorResponse(new Error(`新副本已安全生成，但 Haven 没有切换：${committed.error || '保存失败'}`), committed.httpStatus || 409)
    }
    activateContextGcFork(sessionId, laneId, applied.nextCcSessionId)
    return NextResponse.json({ ok: true, ...applied, context_gc: committed.session?.context_gc || {} })
  } catch (error) {
    return errorResponse(error)
  }
}
