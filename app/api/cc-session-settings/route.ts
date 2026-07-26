import { NextRequest } from 'next/server'
import { applyRuntimeSettings, getSessionStats, peekSession } from '@/app/lib/ccSession'

// 「本窗口设置」里能中途改的那几项（5.2）。
//
//   POST /api/cc-session-settings   body: { session_id, model?, effort?, thinking? }
//
// ⚠️ 能改的只有这三项。改不了的（要新建对话）：
//   · 闲聊 / 工作模式 —— systemPrompt 和 tools 是子进程启动参数
//   · 订阅 ↔ 中转站、换哪个中转站 —— 是子进程的环境变量，spawn 时定死
//
// 换模型会让 prompt cache 整个作废（不同模型不共享缓存，换回来也不恢复），
// 所以下一句要重付一次缓存写入。界面上写了这句话。
//
// resume 那条路（重启子进程 + 把历史接回来，让跨中转站也能同窗口切）留作待办，
// 见 HANDOFF「闲聊 / 工作双模式」那节末尾。

export const runtime = 'nodejs'

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const sessionId = String(body.session_id || '').trim()
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })

  // 进程不在时不新建 —— 那会白付一次缓存写入，而且用户要的只是"改个设置"。
  // 前端会把新设置留在本地，下一句话带过去（那时候本来就要起进程）。
  if (!peekSession(sessionId)) {
    return Response.json({
      ok: true,
      applied: false,
      note: '这个对话的进程已经不在了，新设置会在你下一句话时生效',
      stats: getSessionStats(sessionId),
    })
  }

  const patch: { model?: string; effort?: string; thinking?: boolean } = {}
  if ('model' in body) patch.model = String(body.model || '').trim()
  if ('effort' in body) {
    const effort = String(body.effort || '').trim()
    if (effort && !EFFORTS.includes(effort)) {
      return Response.json({ ok: false, error: `effort 只能是 ${EFFORTS.join(' / ')}` }, { status: 400 })
    }
    patch.effort = effort
  }
  if ('thinking' in body) patch.thinking = body.thinking !== false

  const res = await applyRuntimeSettings(sessionId, patch)
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 409 })
  return Response.json({ ok: true, applied: true, stats: getSessionStats(sessionId) })
}
