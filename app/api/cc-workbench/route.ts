import { NextRequest } from 'next/server'
import { workbenchState, type CcWorkbenchState } from '@/app/lib/ccChannel'
import { getSessionStats, peekSession } from '@/app/lib/ccSession'

// 工作台四格的数据源（第 5 步）。
//
//   GET  /api/cc-workbench?session_id=xxx        → 四格的现状
//   POST /api/cc-workbench { session_id, uuid, dry_run? }  → 回退到某句话之前
//
// 「现在」的四个问题（handoff 文档里定的）：
//   1. 有什么在等我批准        → pending
//   2. 这一轮改了哪些文件      → files
//   3. 能退回到哪              → checkpoints（⚠️ 只在子进程活着时有效）
//   4. 刚才那条命令输出是什么  → commands
//
// 全部是**当前会话**范围，不是历史全库。历史那份写在 Haven 的 raw_json 里，
// 由聊天页读回来显示。

export const runtime = 'nodejs'

type Body = {
  session_id?: string
  /** 回退到哪条用户消息之前（工作台列表里的 uuid） */
  uuid?: string
  /** true = 只看会改哪些文件，不真的动 */
  dry_run?: boolean
}

function payload(sessionId: string, state: CcWorkbenchState) {
  const stats = getSessionStats(sessionId)
  return {
    ok: true,
    session_id: sessionId,
    // 子进程还活着吗 —— 决定「回退」这一格是可点的还是灰的
    live: stats.live,
    stats,
    pending: state.pending,
    decided: state.decided,
    files: state.files,
    commands: state.commands,
    // 进程没了备份也没了，这时候不给假的可点项
    checkpoints: stats.live ? state.checkpoints : [],
    auto_allow_edits: state.autoAllowEdits,
    at: Date.now(),
  }
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  return Response.json(payload(sessionId, workbenchState(sessionId)))
}

export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const sessionId = (body.session_id || '').trim()
  const uuid = (body.uuid || '').trim()
  if (!sessionId || !uuid) {
    return Response.json({ ok: false, error: 'session_id / uuid 为空' }, { status: 400 })
  }

  // ⚠️ 这里故意用 peekSession 而不是 ensureSession：会话已经被回收的话，
  // 文件备份跟着子进程一起没了。新起一个进程既白付一次缓存，也还是回不了。
  const live = peekSession(sessionId)
  if (!live) {
    return Response.json(
      {
        ok: false,
        error:
          '这个会话的子进程已经回收了（闲置超时或手动收掉），文件备份跟着一起没了，回退不了。' +
          '想撤销改动就用 git（改了哪些文件在工作台里有记录）。',
      },
      { status: 409 },
    )
  }
  if (live.busy) {
    return Response.json({ ok: false, error: '这一轮还在跑，等它结束再回退' }, { status: 409 })
  }

  try {
    const result = await live.q.rewindFiles(uuid, { dryRun: body.dry_run === true })
    return Response.json({
      ok: result.canRewind !== false,
      dry_run: body.dry_run === true,
      can_rewind: result.canRewind,
      error: result.error || undefined,
      files_changed: result.filesChanged || [],
      insertions: result.insertions ?? 0,
      deletions: result.deletions ?? 0,
    })
  } catch (e) {
    const err = e as Error
    return Response.json(
      { ok: false, error: `回退失败：${err.message || String(err)}` },
      { status: 500 },
    )
  }
}
