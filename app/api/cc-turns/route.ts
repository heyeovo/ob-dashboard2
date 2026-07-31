import { NextRequest } from 'next/server'
import {
  listSessions,
  listTurns,
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
  return ''
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('session_id')
  const rawSource = sp.get('source')
  const source =
    rawSource === 'cc' || rawSource === 'gateway' || rawSource === 'polaris'
      ? (rawSource as TurnSource)
      : undefined

  if (sessionId) {
    const res = await listTurns(sessionId, {
      limit: Number(sp.get('limit') || 200),
      includeRaw: sp.get('raw') === '1',
    })
    if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })
    return Response.json({
      ok: true,
      session_id: sessionId,
      count: res.turns.length,
      turns: res.turns,
    })
  }

  const res = await listSessions({ limit: Number(sp.get('limit') || 50), source })
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })

  // 按协作者过滤。规则（用户拍板）：
  //   · client 里写了归属的 → 只给对应那个协作者
  //   · 无主的（4.5b 之前的老对话）→ 全算给 LEGACY_OWNER
  //   · Polaris 那些 source != 'cc' 的会话不参与，照旧全都显示
  const personaId = (sp.get('persona_id') || '').trim()
  const sessions = personaId
    ? res.sessions.filter(s => {
        if (s.source !== 'cc') return true
        const owner = personaOfClient(s.client) || LEGACY_OWNER
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
  const body = await request.json().catch(() => null) as { session_id?: string; title?: string } | null
  const sessionId = (body?.session_id || '').trim()
  const title = (body?.title || '').trim()
  if (!sessionId || !title) {
    return Response.json({ ok: false, error: 'session_id / title 不能为空' }, { status: 400 })
  }
  const result = await renameConversationSession(sessionId, title)
  return Response.json(
    { ok: result.ok, session_id: sessionId, title: result.title, error: result.error || undefined },
    { status: result.ok ? 200 : 502 },
  )
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as { session_id?: string } | null
  const sessionId = (body?.session_id || '').trim()
  if (!sessionId) {
    return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  }
  const result = await softDeleteConversationSession(sessionId)
  return Response.json(
    { ok: result.ok, session_id: sessionId, deleted: result.ok, error: result.error || undefined },
    { status: result.ok ? 200 : 502 },
  )
}
