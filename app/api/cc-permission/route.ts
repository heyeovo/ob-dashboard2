import { NextRequest } from 'next/server'
import {
  answerPermission,
  setAutoAllowEdits,
  workbenchState,
} from '@/app/lib/ccChannel'

// 批准 / 拒绝一个操作（第 5 步）。
//
//   GET  /api/cc-permission?session_id=xxx   → 现在挂着哪些、刚才决定过什么
//   POST /api/cc-permission  { session_id, id, decision, reason?, remember? }
//
// 为什么要 GET：待批准的东西活在服务端队列里，不只活在 SSE 流里。
// 手机上滑走、页面刷新、换个设备打开，都靠这个 GET 把「现在等着谁点」拉回来。
//
// ⚠️ 这条路由本身没有身份校验 —— 它靠 proxy.ts 那道共享密钥挡外网。
// 内网/本机访问是信任的，这跟聊天路由是同一套边界。

export const runtime = 'nodejs'

type Body = {
  session_id?: string
  id?: string
  /** allow | deny */
  decision?: string
  /** 拒绝时想说的话，会原样给模型看。不写就用默认那句 */
  reason?: string
  /** 只对 allow 有效：本会话之后的 Edit / Write 不再问。⚠️ 不含 Bash */
  remember?: boolean
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  const state = workbenchState(sessionId)
  return Response.json({
    ok: true,
    pending: state.pending,
    decided: state.decided,
    auto_allow_edits: state.autoAllowEdits,
  })
}

export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const sessionId = (body.session_id || '').trim()
  const id = (body.id || '').trim()
  if (!sessionId || !id) {
    return Response.json({ ok: false, error: 'session_id / id 为空' }, { status: 400 })
  }

  const allow = body.decision === 'allow'

  // 「以后都放行」要在答复之前开，不然这一条之后紧跟着的下一条会抢在开关前面问一遍
  if (allow && body.remember) setAutoAllowEdits(sessionId, true)

  const done = answerPermission(
    sessionId,
    id,
    allow
      ? { behavior: 'allow' }
      : {
          behavior: 'deny',
          // ⚠️ 前缀不能省。实测只把用户那句话（比如「这次不跑」）原样递过去，
          // 模型会把它当成一句闲聊，接着回「已输出」—— 明明什么都没跑。
          // 所以先用一句不会被误读的话说清「没执行」，用户的话再附在后面。
          message:
            '用户拒绝了这个操作，它没有被执行 —— 命令没跑，文件没改。' +
            '别换个写法重试同一件事，也别在回复里说它做完了。' +
            ((body.reason || '').trim()
              ? `用户的话：${(body.reason || '').trim()}`
              : '先说清楚你为什么要做它，然后等用户回话。'),
        },
  )

  if (!done) {
    // 超时自动拒过了 / 点重了 / 服务重启把队列丢了。前端照实说，不假装成功。
    return Response.json(
      { ok: false, error: '这条已经不在等待队列里了（可能已超时、已点过，或服务重启过）' },
      { status: 409 },
    )
  }

  const state = workbenchState(sessionId)
  return Response.json({
    ok: true,
    pending: state.pending,
    decided: state.decided,
    auto_allow_edits: state.autoAllowEdits,
  })
}

/** 关掉「本会话都放行」。前端那个开关关闭时打这个。 */
export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  setAutoAllowEdits(sessionId, false)
  return Response.json({ ok: true, auto_allow_edits: false })
}
