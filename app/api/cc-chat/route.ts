import { NextRequest } from 'next/server'
import { resolveDirs, resolveWriteDirs } from '@/app/lib/ccDirs'
import type { CredMode } from '@/app/lib/ccEnv'
import { buildPersonaAppend, getPersona, type HavenPersona } from '@/app/lib/havenPersonas'
import { sessionStaticContext } from '@/app/lib/runtimeContext'
import { loadUpstreamConfig, resolveProvider } from '@/app/lib/havenUpstream'
import {
  loadPermanentPermissionRules,
  permissionRuleStrings,
} from '@/app/lib/havenPermissions'
import { loadMcpConfig, toSdkMcpServers, disabledMcpTools } from '@/app/lib/ccMcp'
import { getSessionStats, dropSession, getFrozenAppend, setFrozenAppend, clearFrozenAppend } from '@/app/lib/ccSession'
import { resetChannel } from '@/app/lib/ccChannel'
import { isCcMode, type CcMode } from '@/app/lib/ccModes'
import { normalizeWebSettings } from '@/app/cc/webSettings'
import {
  clearWriteDirs,
  ccLaneId,
  sdkModelForProvider,
  setWriteDirs,
  type TurnConfig,
} from '@/app/lib/cc/ccOptions'
import { clearRecallPrefs, runTurn, setRecallPrefs } from '@/app/lib/cc/runTurn'
import { clearTurnBucket } from '@/app/lib/cc/processCollector'
import { encodeSse } from '@/app/lib/cc/sseEvents'
import {
  dailyReviewSystemBlock,
  getConversationSession,
  getTurnByRequestId,
  patchConversationSessionState,
  type HavenTurn,
} from '@/app/lib/havenTurns'
import { resolveAttachments } from '@/app/lib/havenAttachments'
import { handoffSnapshotContent, type HandoffSnapshot } from '@/app/lib/cc/handoffSnapshot'

// 聊天页的流式路由（第 4 步建，第 5 步加写权限，9.5 步瘦身成薄壳）。
//
//   POST /api/cc-chat   body: { session_id, text, cred?, model?, semantic? }
//   → text/event-stream，逐字吐 delta
//
// 9.5 之前的 POST 有 1000 行：SDK options 组装、hooks、主循环、召回、写库
// 全在 ReadableStream 的闭包里。现在拆成三层：
//   1. 本文件：body 解析 → 读 Haven 配置 → 组装 TurnConfig 快照 → 建 SSE 流
//   2. ccOptions.ts：SDK Options 组装（buildCcOptions / hooks / canUseTool）
//   3. runTurn.ts：一轮对话的执行（召回、主循环、写库、失败收尾）
//
// ⚠️ 三条硬约束在 runTurn.ts 文件头里，拆的时候一行都没放松。

export const runtime = 'nodejs'
// ⚠️ 300 是 Vercel Hobby 计划的上限，写 600 会让线上部署直接失败
//（Build Failed: invalid maxDuration ... must be between 1 and 300）。
// 这个值只约束 Vercel 上的 serverless function，**本地 dev 不受它限制**，
// 所以长会话在本地不受影响。
// 而且这条路由在线上本来就跑不起来（serverless 没有 claude code 二进制、
// 不能长驻子进程）—— 真正的解法是让它不进线上构建，见 handoff 文档
// 「线上部署要处理的事」一节，导航重构那轮一起做。
export const maxDuration = 300

type ChatBody = {
  session_id?: string
  request_id?: string
  expected_last_round_id?: number
  text?: string
  attachment_ids?: string[]
  cred?: string
  model?: string
  semantic?: boolean
  /** 传 false 就不查记忆（调试用） */
  recall?: boolean
  /** 4.5b：用哪个协作者。提示词 / 记忆条目 / 两个召回开关 / 引擎都从它来 */
  persona_id?: string
  /** 5.2：chat = 闲聊（零工具），work = 工作。只在会话第一轮生效 */
  mode?: string
  /** 兼容旧窗口：新弹窗的日回顾已进入 handoff_snapshot。 */
  include_daily_review?: boolean
  /** API 线路的中转站；切换时进入该 provider 独立的 Claude session。 */
  provider_id?: string
  /** 5.2：reasoning effort。第一轮生效，之后走 /api/cc-session-settings 中途改 */
  effort?: string
  /** 5.2：开不开 thinking */
  thinking?: boolean
  web_search_enabled?: boolean
  web_fetch_enabled?: boolean
  web_max_searches?: number
  web_max_fetches?: number
  web_fetch_target_tokens?: number
  web_max_sources?: number
  web_domain_mode?: string
  web_domains?: string[]
  /**
   * 第 5 条 resume：前端从历史最后一轮读出的 claude code session id。
   * 只在服务端进程已丢（重启 / 回收）时用来接回上下文；已有活进程则忽略。
   */
  resume_hint?: string
  /** 旧会话过渡用：只有 hint 所属线路与本轮实际线路一致时才允许 resume。 */
  resume_hint_lane_id?: string
  /** 新窗口首条提交的统一固定快照；Haven 首次保存后冻结。 */
  handoff_snapshot?: HandoffSnapshot
}

function rawRecord(rawJson: string | undefined): Record<string, unknown> {
  if (!rawJson) return {}
  try {
    const parsed = JSON.parse(rawJson)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function replayCcTurn(turn: HavenTurn, body: ChatBody): Response {
  const raw = rawRecord(turn.raw_json)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      send('start', {
        session_id: turn.session_id,
        request_id: body.request_id,
        at: Date.now(),
        idempotent_replay: true,
      })
      send('init', {
        engine: 'cc',
        model: turn.model || raw.model || '',
        provider_id: raw.provider_id || '',
        provider_label: raw.provider_label || '',
        request_id: body.request_id,
        idempotent_replay: true,
      })
      if (raw.recall && typeof raw.recall === 'object') send('recall', raw.recall)
      if (raw.context && typeof raw.context === 'object') send('context', raw.context)
      const process = Array.isArray(raw.process) ? raw.process : []
      let replayedText = false
      for (const part of process) {
        if (!part || typeof part !== 'object') continue
        const item = part as Record<string, unknown>
        const text = String(item.text || '')
        if (!text) continue
        if (item.type === 'thinking') {
          send('thinking', {
            text,
            id: String(item.id || 'thinking-0'),
            startedAt: Number(item.startedAt || Date.now()),
          })
        } else if (item.type === 'text') {
          replayedText = true
          send('delta', { text, id: String(item.id || 'text-0') })
        }
      }
      if (!replayedText && turn.assistant_text) send('delta', { text: turn.assistant_text, id: 'text-0' })
      if (raw.usage && typeof raw.usage === 'object') send('usage', raw.usage)
      send('done', {
        request_id: body.request_id,
        turn_id: turn.id,
        round_id: turn.round_id,
        idempotent_replay: true,
        generated: false,
        usage: raw.usage || null,
        context: raw.context || null,
        continuity_turns:
          raw.continuity && typeof raw.continuity === 'object'
            ? Number((raw.continuity as Record<string, unknown>).injected_turns || 0)
            : 0,
        stats: getSessionStats(turn.session_id),
      })
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * 这一轮要拉的东西（跑 runTurn 之前）。
 * ⚠️ 只做「拉数据」，不做「定逻辑」—— 逻辑在 runTurn 里，这里不碰。
 */
async function loadTurnInputs(body: ChatBody) {
  // 协作者：读不到就当没有，聊天照常（退回 claude code 自带的系统提示）。
  // 配置读不出来不该让人发不了话。
  let persona: HavenPersona | null = null
  if (body.persona_id) {
    const res = await getPersona(body.persona_id)
    persona = res.persona
  }

  // 引擎 → 额度。selfhost 是第 7 步的自建引擎，走到这里一律按中转站算。
  const engine = persona?.engine || ''
  const credFromEngine: CredMode = engine === 'subscription' ? 'subscription' : 'api'
  // body 里显式传的优先（本窗口设置选的），否则听协作者
  const cred: CredMode = body.cred === 'subscription'
    ? 'subscription'
    : body.cred === 'api'
      ? 'api'
      : credFromEngine

  // 5.2 闲聊 / 工作。默认工作 —— 4.5b 之前的老会话和不带这个字段的调用都按老行为走。
  const mode: CcMode = isCcMode(body.mode) ? body.mode : 'work'
  const initializedSession = await patchConversationSessionState({
    sessionId: String(body.session_id || ''),
    personaId: String(body.persona_id || ''),
    mode,
    dailyReviewEnabled: body.include_daily_review !== false,
    initializeDailyReviewSnapshot: true,
    handoffSnapshot: body.handoff_snapshot,
  })
  if (!initializedSession.ok) {
    throw new Error(`初始化窗口固定背景失败：${initializedSession.error || 'Haven 写入失败'}`)
  }
  const webSettings = normalizeWebSettings({
    search_enabled: body.web_search_enabled,
    fetch_enabled: body.web_fetch_enabled,
    max_searches_per_turn: body.web_max_searches,
    max_fetches_per_turn: body.web_max_fetches,
    fetch_target_tokens: body.web_fetch_target_tokens,
    max_displayed_sources: body.web_max_sources,
    domain_mode: body.web_domain_mode,
    domains: body.web_domains,
  })
  const activeWebTools = [
    ...(webSettings.searchEnabled ? ['WebSearch'] : []),
    ...(webSettings.fetchEnabled ? ['WebFetch'] : []),
  ]

  // 5.2 上游：走 Haven 那份「上游模型配置」。
  // ⚠️ token 只在服务端出现，前端送的是 provider_id。读不到配置就退回 .env.local
  // 那一条（第 4 步起的行为），不能让聊天页因为配置拿不到就发不了话。
  let providerId = ''
  let providerLabel = ''
  let envOverrides: { baseUrl?: string; authToken?: string } = {}
  let model = body.model || ''
  let effort = String(body.effort || '')
  const thinking = body.thinking !== false
  if (cred === 'api') {
    const up = await loadUpstreamConfig()
    if (up.ok) {
      const hit = resolveProvider(up.config, String(body.provider_id || ''))
      if (hit) {
        providerId = String(body.provider_id || up.config.default_provider_id || '')
        providerLabel = hit.label
        envOverrides = { baseUrl: hit.baseUrl, authToken: hit.authToken }
      }
      if (!model) model = String(up.config.default_model || '')
      if (!effort) effort = String(up.config.default_effort || '')
    }
  }
  if (!model) model = process.env.ANTHROPIC_MODEL || ''
  const mcpConfig = await loadMcpConfig()
  const permanentPermissions = await loadPermanentPermissionRules()
  const permanentAllowRules = permanentPermissions.ok
    ? permissionRuleStrings(permanentPermissions.rules)
    : []

  let sessionSnapshot = await getConversationSession(body.session_id || '', {
    includeBucketExclusions: true,
  })
  if (!sessionSnapshot.ok || !sessionSnapshot.session) {
    throw new Error(`读取窗口固定背景失败：${sessionSnapshot.error || 'Haven 返回空窗口'}`)
  }
  const laneId = ccLaneId(cred, providerId)
  const laneState = sessionSnapshot.session?.cc_lanes?.[laneId]
  const persistedResumeHint = String(laneState?.cc_session_id || '').trim()
  const legacyResumeHint = String(body.resume_hint_lane_id || '').trim() === laneId
    ? String(body.resume_hint || '').trim()
    : ''
  let personaAppend = buildPersonaAppend(
    persona,
    sessionSnapshot.session?.prompt_module_overrides,
  )

  // CC 的每条原生线路在启动时读取 Haven 同一份冻结快照；活跃 query 的
  // systemPromptKey 不变，不会逐轮重复追加。selfhost 也读取这个字段。
  const handoffBlock = handoffSnapshotContent(sessionSnapshot.session?.handoff_snapshot)
  personaAppend = [personaAppend, handoffBlock].filter(Boolean).join('\n\n')
  const dailyReviewBlock = sessionSnapshot.session?.daily_review_enabled
    ? dailyReviewSystemBlock(sessionSnapshot.session.daily_review_snapshot)
    : ''
  personaAppend = [personaAppend, dailyReviewBlock].filter(Boolean).join('\n\n')
  personaAppend = [personaAppend, sessionStaticContext(sessionId)].filter(Boolean).join('\n\n')

  // 缓存稳定性：同一个 session 生命周期内 personaAppend 不能变，否则 resume 后
  // 系统提示前缀跟原来对不上 → 1h 缓存 miss → 全量重写。
  // 首次建会话时写入 Haven 并冻结，后续轮次、Dashboard 重部署和换设备都复用。
  // 进程内 Map 只做热路径缓存，不再是唯一事实源。
  if (sessionSnapshot.session.frozen_persona_append_initialized) {
    personaAppend = sessionSnapshot.session.frozen_persona_append
  } else {
    const candidate = getFrozenAppend(body.session_id || '') ?? personaAppend
    const saved = await patchConversationSessionState({
      sessionId: String(body.session_id || ''),
      personaId: String(body.persona_id || ''),
      frozenPersonaAppend: candidate,
      expectedStateVersion: sessionSnapshot.session.state_version,
    })
    if (saved.ok && saved.session?.frozen_persona_append_initialized) {
      sessionSnapshot = { ...sessionSnapshot, session: saved.session }
      personaAppend = saved.session.frozen_persona_append
    } else {
      // 两个请求同时首次启动时，另一个可能先写入并让 CAS 冲突；重读已冻结值即可。
      const reread = await getConversationSession(body.session_id || '', {
        includeBucketExclusions: true,
      })
      if (!reread.ok || !reread.session?.frozen_persona_append_initialized) {
        throw new Error(`保存窗口缓存前缀失败：${saved.error || reread.error || 'Haven 写入失败'}`)
      }
      sessionSnapshot = reread
      personaAppend = reread.session.frozen_persona_append
    }
  }
  setFrozenAppend(body.session_id || '', personaAppend)
  const systemPromptKey = personaAppend

  // 能读哪些目录：本机没配退回仓库根；production 没配只进 dashboard workspace。
  // 敏感文件的拦截跟这个无关，是 ccOptions 里 PreToolUse 那道硬规则。
  const { cwd, additionalDirectories } = await resolveDirs(persona?.dirs)
  // 能写哪些目录：另一份更窄的清单，**空 = 一个字都不许写**（跟读的规则相反）。
  // 每轮重存，所以配置改完立刻生效 —— 不像提示词要等新对话。
  const writeDirs = await resolveWriteDirs(persona?.write_dirs)
  setWriteDirs(body.session_id || '', writeDirs)

  // 两个召回开关同样是 body 优先、协作者兜底，存进表让 runTurn 每轮重读
  setRecallPrefs(body.session_id || '', {
    recall: body.recall !== undefined ? body.recall !== false : persona?.recall_on !== false,
    semantic: body.semantic !== undefined ? body.semantic !== false : persona?.semantic_on !== false,
  })

  const config: TurnConfig = {
    sessionId: body.session_id || '',
    mode,
    personaAppend,
    systemPromptKey,
    cwd,
    additionalDirectories,
    activeWebTools,
    sdkModel: sdkModelForProvider(model, cred),
    effort,
    thinking,
    sdkMcpServers: toSdkMcpServers(mcpConfig),
    disabledTools: disabledMcpTools(mcpConfig),
    webSettings,
    permanentAllowRules,
    cred,
    laneId,
    envOverrides,
    model,
    providerId,
    providerLabel,
  }

  return {
    persona,
    config,
    sessionSnapshot,
    resumeHint: persistedResumeHint || legacyResumeHint,
  }
}

export async function POST(request: NextRequest) {
  // 计时基点放在最前面 —— 读协作者配置要去 Zeabur，那一步也算「等回复」的时间
  const reqAt = Date.now()
  let body: ChatBody
  try {
    body = (await request.json()) as ChatBody
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const sessionId = (body.session_id || '').trim()
  const requestId = (body.request_id || '').trim()
  const personaId = (body.persona_id || '').trim()
  const text = (body.text || '').trim()
  const attachmentIds = Array.isArray(body.attachment_ids)
    ? [...new Set(body.attachment_ids.map(String).map(value => value.trim()).filter(Boolean))]
    : []
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  if (!requestId) return Response.json({ ok: false, error: 'request_id 为空' }, { status: 400 })
  if (requestId.length > 128) return Response.json({ ok: false, error: 'request_id 不能超过 128 个字符' }, { status: 400 })
  if (!personaId) return Response.json({ ok: false, error: 'persona_id 为空' }, { status: 400 })
  if (!text && attachmentIds.length === 0) return Response.json({ ok: false, error: '文字和附件不能同时为空' }, { status: 400 })
  if (attachmentIds.length > 4) return Response.json({ ok: false, error: '每轮图片和文件合计最多 4 个' }, { status: 400 })
  const expectedLastRoundId = Number(body.expected_last_round_id)
  if (!Number.isInteger(expectedLastRoundId) || expectedLastRoundId < 0) {
    return Response.json({ ok: false, error: 'expected_last_round_id 必须是大于或等于 0 的整数' }, { status: 400 })
  }
  const existing = await getTurnByRequestId(requestId, { signal: request.signal })
  if (!existing.ok) {
    return Response.json({ ok: false, error: existing.error || '幂等状态查询失败' }, { status: existing.httpStatus || 502 })
  }
  if (existing.found && existing.turn) {
    const raw = rawRecord(existing.turn.raw_json)
    const storedPersonaId = String(existing.turn.persona_id || raw.persona_id || '')
    const matches = existing.turn.session_id === sessionId
      && existing.turn.user_text === text
      && storedPersonaId === personaId
      && JSON.stringify((existing.turn.attachments || []).map(item => item.id)) === JSON.stringify(attachmentIds)
    if (!matches) {
      return Response.json({
        ok: false,
        error: 'request_id_reused',
        message: '这个 request_id 已用于另一条消息',
      }, { status: 409 })
    }
    return replayCcTurn(existing.turn, body)
  }

  let inputs: Awaited<ReturnType<typeof loadTurnInputs>>
  try {
    inputs = await loadTurnInputs(body)
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : '初始化窗口失败',
    }, { status: 502 })
  }
  const { persona, config, sessionSnapshot, resumeHint } = inputs
  let attachments
  try {
    attachments = await resolveAttachments(attachmentIds, sessionId)
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : '附件读取失败' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const startedAt = reqAt

  // 慢在哪一段：每个节点打一行「距开始多少毫秒」到 dev 控制台。
  // 前半段（发出去半天不出字）多半是召回要去 Zeabur 查，跟模型无关，靠这几行能分清。
  let lastStampAt = startedAt
  const stamp = (label: string) => {
    const now = Date.now()
    console.log(
      `[cc-chat ${sessionId} request=${requestId}] ${label} +${now - startedAt}ms (上一步用了 ${now - lastStampAt}ms)`,
    )
    lastStampAt = now
  }
  stamp('配置读完（协作者 / 目录，这一步要去 Zeabur）')

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(encodeSse(event as never, data as never)))
        } catch {
          closed = true
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* 已经关了 */
        }
      }

      await runTurn({
        sessionId,
        requestId,
        expectedLastRoundId,
        personaId,
        text,
        attachments,
        persona,
        config,
        sessionSnapshot,
        signal: request.signal,
        send,
        close,
        stamp,
        resumeHint,
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** 拿会话的实时状态（费用、缓存剩余时间）。前端顶部轮询用。 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  return Response.json({ ok: true, stats: getSessionStats(sessionId) })
}

/** 主动收掉一个会话的子进程（切走会话 / 想重新开始时用）。 */
export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  dropSession(sessionId)
  clearRecallPrefs(sessionId)
  clearWriteDirs(sessionId)
  clearTurnBucket(sessionId)
  clearFrozenAppend(sessionId)
  // 工作台那四格跟着清 —— 回退点已经随子进程失效了，留着只会骗人
  resetChannel(sessionId, '会话被手动收掉了，这个操作取消。')
  return Response.json({ ok: true })
}
