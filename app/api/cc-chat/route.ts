import { NextRequest } from 'next/server'
import { getBucket } from '@/app/lib/api'
import { resolveDirs, resolveWriteDirs } from '@/app/lib/ccDirs'
import type { CredMode } from '@/app/lib/ccEnv'
import { buildPersonaAppend, getPersona, type HavenPersona } from '@/app/lib/havenPersonas'
import { loadUpstreamConfig, resolveProvider } from '@/app/lib/havenUpstream'
import {
  loadPermanentPermissionRules,
  permissionRuleStrings,
} from '@/app/lib/havenPermissions'
import { loadMcpConfig, toSdkMcpServers, disabledMcpTools } from '@/app/lib/ccMcp'
import { getSessionStats, dropSession, peekSession } from '@/app/lib/ccSession'
import { resetChannel } from '@/app/lib/ccChannel'
import { isCcMode, type CcMode } from '@/app/lib/ccModes'
import { normalizeWebSettings } from '@/app/cc/webSettings'
import {
  clearWriteDirs,
  sdkModelForProvider,
  setWriteDirs,
  type TurnConfig,
} from '@/app/lib/cc/ccOptions'
import { clearRecallPrefs, runTurn, setRecallPrefs } from '@/app/lib/cc/runTurn'
import { clearTurnBucket } from '@/app/lib/cc/processCollector'
import { encodeSse } from '@/app/lib/cc/sseEvents'
import { getConversationSession, getTurnByRequestId, type HavenTurn } from '@/app/lib/havenTurns'
import { resolveAttachments } from '@/app/lib/havenAttachments'

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
  /** 5.2：哪个中转站（api 时）。只在第一轮生效，服务端翻成 baseUrl + token */
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
  /**
   * 5.5 换窗 handoff：只随新会话首条带一次，之后几轮不带。
   *   handoff_bucket_ids   勾选的记忆桶 id → 服务端拉正文，拼进 systemPrompt（全程稳定、可缓存）
   *   handoff_from_session 源会话 id + handoff_turns 轮数 → 服务端拉原文，拼进首条 user 正文
   */
  handoff_bucket_ids?: string[]
  handoff_turns?: number
  handoff_from_session?: string
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

  const sessionSnapshot = await getConversationSession(body.session_id || '', {
    includeBucketExclusions: true,
  })
  let personaAppend = buildPersonaAppend(
    persona,
    sessionSnapshot.session?.prompt_module_overrides,
  )
  const systemPromptKey = personaAppend

  // 5.5 换窗 handoff：勾选的记忆桶拼进 systemPrompt.append。
  // 为什么进系统提示而不是 user 正文：这批桶是「带过来的稳定背景」，希望它全程都在、
  //   而且属于可缓存前缀（1h 档），不像召回是每轮变的。只有新会话首条才带 —— 已有进程
  //   的 systemPrompt 是启动时定死的，中途送来也改不了，所以这里只在没活进程时才拉。
  // 任何失败都不拦发话：拉不到就当没带这批桶。
  const handoffBucketIds = Array.isArray(body.handoff_bucket_ids) ? body.handoff_bucket_ids : []
  if (handoffBucketIds.length > 0 && !peekSession(body.session_id || '')) {
    const parts: string[] = []
    for (const id of handoffBucketIds.slice(0, 10)) {
      try {
        const b = await getBucket(String(id))
        const title = String(b?.name || b?.title || id)
        const content = String(b?.content || '').trim()
        if (content) parts.push(`【${title}】\n${content}`)
      } catch {
        // 单个桶拉不到就跳过，不影响其余
      }
    }
    if (parts.length > 0) {
      const block =
        '<换窗记忆>\n' +
        '以下是用户从上一个窗口带过来的记忆，作为本次对话的稳定背景。\n\n' +
        parts.join('\n\n') +
        '\n</换窗记忆>'
      personaAppend = [personaAppend, block].filter(Boolean).join('\n\n')
    }
  }

  // 能读哪些目录：协作者自己配的，没配就是仓库根。
  // 敏感文件的拦截跟这个无关，是 ccOptions 里 PreToolUse 那道硬规则。
  const { cwd, additionalDirectories } = resolveDirs(persona?.dirs)
  // 能写哪些目录：另一份更窄的清单，**空 = 一个字都不许写**（跟读的规则相反）。
  // 每轮重存，所以配置改完立刻生效 —— 不像提示词要等新对话。
  const writeDirs = resolveWriteDirs(persona?.write_dirs)
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
    sdkModel: sdkModelForProvider(model),
    effort,
    thinking,
    sdkMcpServers: toSdkMcpServers(mcpConfig),
    disabledTools: disabledMcpTools(mcpConfig),
    webSettings,
    permanentAllowRules,
    cred,
    envOverrides,
    model,
    providerId,
    providerLabel,
  }

  return {
    persona,
    config,
    sessionSnapshot,
    handoff: {
      bucketIds: handoffBucketIds,
      turns: Number(body.handoff_turns) || 0,
      fromSession: String(body.handoff_from_session || '').trim(),
    },
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

  const { persona, config, handoff, sessionSnapshot } = await loadTurnInputs(body)
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
      `[cc-chat ${sessionId.slice(0, 8)}] ${label} +${now - startedAt}ms (上一步用了 ${now - lastStampAt}ms)`,
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
        handoff,
        signal: request.signal,
        send,
        close,
        stamp,
        resumeHint: body.resume_hint,
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
  // 工作台那四格跟着清 —— 回退点已经随子进程失效了，留着只会骗人
  resetChannel(sessionId, '会话被手动收掉了，这个操作取消。')
  return Response.json({ ok: true })
}
