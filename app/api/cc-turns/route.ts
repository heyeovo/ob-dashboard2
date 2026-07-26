import { NextRequest } from 'next/server'
import { listSessions, listTurns, type TurnSource } from '@/app/lib/havenTurns'

// 第 3 步的读回验证路由（也是第 4 步聊天页会话列表要用的那两个查询）。
//
//   GET /api/cc-turns                    → 会话列表（全部来源）
//   GET /api/cc-turns?source=cc          → 只看 cc 引擎产生的会话
//   GET /api/cc-turns?session_id=xxx     → 某个会话的消息，时间正序
//   GET /api/cc-turns?session_id=xxx&raw=1 → 带上原始 JSON（很长，排查用）
//
// 读的是 Haven 的 conversation_turns —— 跟 Polaris 经 /v1/messages 写进去的是
// 同一张表，所以这里能同时看到两个前端的对话（单一数据源那条硬约束）。

export const runtime = 'nodejs'

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
  return Response.json({
    ok: true,
    source: source ?? 'all',
    count: res.sessions.length,
    sessions: res.sessions,
  })
}
