import { NextRequest } from 'next/server'
import {
  answerPermission,
  pendingPermission,
  setAutoAllowEdits,
  workbenchState,
} from '@/app/lib/ccChannel'
import { addPermanentPermissionRules } from '@/app/lib/havenPermissions'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

// 批准 / 拒绝一个操作（第 5 步）。
//
//   GET  /api/cc-permission?session_id=xxx   → 现在挂着哪些、刚才决定过什么
//   POST /api/cc-permission  { session_id, id, decision, reason?, scope? }
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
  /** once | session | always。remember 是旧版 Edit / Write 的兼容字段。 */
  scope?: string
}

type PermissionScope = 'once' | 'session' | 'always'

function scopedUpdates(suggestions: PermissionUpdate[]): PermissionUpdate[] {
  const updates: PermissionUpdate[] = []
  for (const update of suggestions) {
    if (update.type !== 'addRules' || update.behavior !== 'allow') continue
    const rules = update.rules.filter(rule => {
      const content = String(rule.ruleContent || '').trim()
      if (!content) return false
      if (rule.toolName === 'Bash') return true
      return rule.toolName === 'WebFetch' && content.startsWith('domain:')
    })
    if (rules.length > 0) {
      updates.push({ type: 'addRules', behavior: 'allow', destination: 'session', rules })
    }
  }
  return updates
}

function persistentRules(updates: PermissionUpdate[]) {
  return updates.flatMap(update =>
    update.type === 'addRules'
      ? update.rules.map(rule => ({
          toolName: rule.toolName,
          ruleContent: String(rule.ruleContent || '').trim(),
        }))
      : [],
  )
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
  const scope: PermissionScope =
    body.scope === 'always' ? 'always' : body.scope === 'session' ? 'session' : 'once'
  const pending = pendingPermission(sessionId, id)
  if (!pending) {
    return Response.json(
      { ok: false, error: '这条已经不在等待队列里了（可能已超时、已点过，或服务重启过）' },
      { status: 409 },
    )
  }
  const updates = scopedUpdates(pending.suggestions || [])

  // 「以后都放行」要在答复之前开，不然这一条之后紧跟着的下一条会抢在开关前面问一遍
  if (allow && body.remember) setAutoAllowEdits(sessionId, true)
  if (allow && scope !== 'once' && updates.length === 0 && !body.remember) {
    return Response.json(
      { ok: false, error: 'SDK 没有提供可安全复用的细粒度权限规则，只能批准这一次' },
      { status: 400 },
    )
  }
  if (allow && scope === 'always') {
    const saved = await addPermanentPermissionRules(persistentRules(updates))
    if (!saved.ok) {
      return Response.json(
        { ok: false, error: `永久权限没有保存，当前操作仍在等待：${saved.error}` },
        { status: 502 },
      )
    }
  }

  const done = answerPermission(
    sessionId,
    id,
    allow
      ? {
          behavior: 'allow',
          ...(scope === 'once' || body.remember ? {} : { updatedPermissions: updates }),
          decisionClassification:
            scope === 'once' && !body.remember ? 'user_temporary' : 'user_permanent',
        }
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
          decisionClassification: 'user_reject',
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
