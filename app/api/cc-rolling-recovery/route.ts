import { NextRequest } from 'next/server'
import { resolveDirs } from '@/app/lib/ccDirs'
import { ccLaneId } from '@/app/lib/cc/ccOptions'
import {
  createManualRollingBodyRecoverySeed,
  materializeRollingHistorySeed,
} from '@/app/lib/cc/rollingHistory'
import { buildRollingWindowHistory } from '@/app/lib/cc/windowPrompt'
import {
  activateRollingRecovery,
  prepareSessionForRollingRecovery,
} from '@/app/lib/ccSession'
import { getPersona } from '@/app/lib/havenPersonas'
import {
  commitConversationRollingRecovery,
  getConversationSession,
  listAllTurns,
} from '@/app/lib/havenTurns'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    session_id?: string
    persona_id?: string
    expected_state_version?: number
    confirm?: string
  } | null
  const sessionId = String(body?.session_id || '').trim()
  const personaId = String(body?.persona_id || '').trim()
  if (!sessionId || !personaId) {
    return Response.json({ ok: false, error: 'session_id / persona_id 不能为空' }, { status: 400 })
  }
  if (body?.confirm !== sessionId) {
    return Response.json({ ok: false, error: '请确认当前窗口 ID 后再重建' }, { status: 400 })
  }

  const [loaded, turnsResult, personaResult] = await Promise.all([
    getConversationSession(sessionId, { includeContextDays: true }),
    listAllTurns(sessionId),
    getPersona(personaId),
  ])
  if (!loaded.ok || !loaded.session) {
    return Response.json({ ok: false, error: loaded.error || '窗口不存在' }, { status: 502 })
  }
  if (!turnsResult.ok) {
    return Response.json({ ok: false, error: turnsResult.error || '读取 Haven 正文失败' }, { status: 502 })
  }
  if (!personaResult.ok || !personaResult.persona) {
    return Response.json({ ok: false, error: personaResult.error || '协作者不存在' }, { status: 502 })
  }
  const session = loaded.session
  if (session.persona_id !== personaId) {
    return Response.json({ ok: false, error: '当前窗口不属于这个协作者' }, { status: 409 })
  }
  if (session.rolling_context?.strategy !== 'daily_rolling') {
    return Response.json({ ok: false, error: '只有按天滚动窗口可以执行正文重建' }, { status: 400 })
  }
  if (body?.expected_state_version !== session.state_version) {
    return Response.json({ ok: false, error: '窗口设置刚刚变化，请关闭后重新打开再试' }, { status: 409 })
  }

  const cred = session.cc_overrides?.active_cred === 'subscription' ? 'subscription' : 'api'
  const providerId = cred === 'api' ? String(session.cc_overrides?.api?.provider_id || '') : ''
  const laneId = ccLaneId(cred, providerId)
  const lane = session.cc_lanes?.[laneId]
  const previousCcSessionId = String(lane?.cc_session_id || '').trim()
  if (!previousCcSessionId) {
    return Response.json({ ok: false, error: '当前线路没有可替换的旧 transcript' }, { status: 409 })
  }

  const rollingTurns = buildRollingWindowHistory(session, turnsResult.turns, loaded.contextDays)
  if (rollingTurns.length === 0) {
    return Response.json({ ok: false, error: '当前没有选择任何“原文”轮次，无法创建 transcript' }, { status: 400 })
  }
  const { cwd } = await resolveDirs(personaResult.persona.dirs)
  const seed = createManualRollingBodyRecoverySeed(rollingTurns, {
    cwd,
    fallbackModel: String(lane?.model || ''),
  })
  if (!seed) {
    return Response.json({ ok: false, error: 'Haven 正文没有生成可用 transcript' }, { status: 500 })
  }
  await materializeRollingHistorySeed(seed)

  const prepared = prepareSessionForRollingRecovery(sessionId, laneId, session.context_revision || 0)
  if (!prepared.ok) {
    return Response.json({ ok: false, error: prepared.error }, { status: 409 })
  }
  const committed = await commitConversationRollingRecovery({
    sessionId,
    personaId,
    expectedStateVersion: session.state_version,
    laneId,
    expectedCcSessionId: previousCcSessionId,
    nextCcSessionId: seed.resumeFrom,
    contextRevision: session.context_revision || 0,
    turnCount: rollingTurns.length,
    entryCount: seed.entries.length,
  })
  if (!committed.ok || !committed.session) {
    return Response.json({ ok: false, error: committed.error || '切换新 transcript 失败' }, {
      status: committed.httpStatus || 502,
    })
  }
  activateRollingRecovery(sessionId, laneId, session.context_revision || 0, seed.resumeFrom)
  return Response.json({
    ok: true,
    session: committed.session,
    lane_id: laneId,
    previous_cc_session_id: previousCcSessionId,
    next_cc_session_id: seed.resumeFrom,
    turn_count: rollingTurns.length,
    entry_count: seed.entries.length,
  })
}
