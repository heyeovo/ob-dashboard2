import { NextRequest } from 'next/server'
import {
  listSessions,
  listAllTurns,
  listTurns,
  getConversationSession,
  patchConversationSessionState,
  permanentlyDeleteConversationSession,
  renameConversationSession,
  softDeleteConversationSession,
  type TurnSource,
} from '@/app/lib/havenTurns'

// 第 3 步的读回验证路由（也是第 4 步聊天页会话列表要用的那两个查询）。
//
//   GET /api/cc-turns                    → 会话列表（全部来源）
//   GET /api/cc-turns?source=cc          → 只看 cc 引擎产生的会话
//   GET /api/cc-turns?persona_id=xxx     → 只看属于这个协作者的会话
//   GET /api/cc-turns?session_id=xxx     → 某个会话的消息，时间正序
//   GET /api/cc-turns?session_id=xxx&raw=1 → 带上原始 JSON（很长，排查用）
//
// 读的是 Haven 的 conversation_turns —— 跟 Polaris 经 /v1/messages 写进去的是
// 同一张表，所以这里能同时看到两个前端的对话（单一数据源那条硬约束）。

export const runtime = 'nodejs'

// 4.5b：协作者归属写在 client 列里，形如 `ob2-chat/ombre`（见 cc-chat/route.ts）。
// 会话列表接口不回 raw_json，只能从这一列读。
const LEGACY_CLIENT = 'ob2-chat'
/** 第一个协作者的 id。4.5b 之前的老对话没有归属，一律算给它。 */
const LEGACY_OWNER = 'ombre'

/** 从 client 列读归属。读不出来（老对话 / Polaris 写的）返回空串 = 无主。 */
function personaOfClient(client: string): string {
  const value = (client || '').trim()
  if (value.startsWith(`${LEGACY_CLIENT}/`)) return value.slice(LEGACY_CLIENT.length + 1).trim()
  if (value.startsWith('ob2-selfhost/')) return value.slice('ob2-selfhost/'.length).trim()
  return ''
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('session_id')
  const rawSource = sp.get('source')
  const source =
    rawSource === 'cc' || rawSource === 'selfhost' || rawSource === 'gateway' || rawSource === 'polaris'
      ? (rawSource as TurnSource)
      : undefined

  if (sessionId) {
    const [res, state] = await Promise.all([
      sp.get('all') === '1'
        ? listAllTurns(sessionId, { includeRaw: sp.get('raw') === '1' })
        : listTurns(sessionId, {
            limit: Number(sp.get('limit') || 200),
            beforeId: sp.get('before_id') ? Number(sp.get('before_id')) : undefined,
            afterRoundId: sp.get('after_round_id') ? Number(sp.get('after_round_id')) : undefined,
            includeRaw: sp.get('raw') === '1',
          }),
      getConversationSession(sessionId),
    ])
    if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })
    if (!state.ok) return Response.json({ ok: false, error: state.error }, { status: 502 })
    return Response.json({
      ok: true,
      session_id: sessionId,
      count: res.turns.length,
      turns: res.turns,
      session: state.found ? state.session : null,
    })
  }

  const res = await listSessions({
    limit: Number(sp.get('limit') || 50),
    source,
    deleted: sp.get('deleted') === '1',
  })
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })

  // 按协作者过滤。所有来源统一遵守窗口归属，避免 Polaris / Gateway
  // 导入窗口在每个协作者名下重复出现。无主旧窗口仍归 LEGACY_OWNER。
  const personaId = (sp.get('persona_id') || '').trim()
  const sessions = personaId
    ? res.sessions.filter(s => {
        const owner = s.persona_id || personaOfClient(s.client) || LEGACY_OWNER
        return owner === personaId
      })
    : res.sessions

  return Response.json({
    ok: true,
    source: source ?? 'all',
    persona_id: personaId || null,
    count: sessions.length,
    sessions,
  })
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    session_id?: string
    title?: string
    persona_id?: string
    local_engine_preference?: string
    prompt_module_overrides?: Record<string, boolean>
    expected_state_version?: number
  } | null
  const sessionId = (body?.session_id || '').trim()
  const title = (body?.title || '').trim()
  const preference = body?.local_engine_preference
  const hasPromptOverrides = body?.prompt_module_overrides !== undefined
  if (!sessionId) {
    return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  }
  let session = null
  if (preference === 'cc' || preference === 'selfhost' || hasPromptOverrides) {
    const result = await patchConversationSessionState({
      sessionId,
      personaId: String(body?.persona_id || ''),
      localEnginePreference: preference === 'cc' || preference === 'selfhost' ? preference : undefined,
      promptModuleOverrides: hasPromptOverrides
        ? body?.prompt_module_overrides && typeof body.prompt_module_overrides === 'object'
          ? body.prompt_module_overrides
          : {}
        : undefined,
      expectedStateVersion: body?.expected_state_version,
    })
    if (!result.ok) {
      return Response.json(
        { ok: false, session_id: sessionId, session: null, error: result.error || undefined },
        { status: result.httpStatus || 502 },
      )
    }
    session = result.session
    if (!title) {
      return Response.json({ ok: true, session_id: sessionId, session })
    }
  }
  if (!title) {
    return Response.json({ ok: false, error: 'title 或窗口设置不能为空' }, { status: 400 })
  }
  const result = await renameConversationSession(sessionId, title)
  return Response.json(
    { ok: result.ok, session_id: sessionId, title: result.title, session, error: result.error || undefined },
    { status: result.ok ? 200 : 502 },
  )
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    session_id?: string
    permanent?: boolean
    confirm_session_id?: string
  } | null
  const sessionId = (body?.session_id || '').trim()
  if (!sessionId) {
    return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  }
  if (body?.permanent === true) {
    const result = await permanentlyDeleteConversationSession(sessionId, String(body.confirm_session_id || ''))
    return Response.json(
      {
        ok: result.ok,
        session_id: sessionId,
        deleted: result.ok,
        permanent: result.ok,
        deleted_counts: result.deletedCounts,
        memory_buckets_deleted: 0,
        error: result.error || undefined,
      },
      { status: result.ok ? 200 : 502 },
    )
  }
  const result = await softDeleteConversationSession(sessionId)
  return Response.json(
    { ok: result.ok, session_id: sessionId, deleted: result.ok, error: result.error || undefined },
    { status: result.ok ? 200 : 502 },
  )
}
