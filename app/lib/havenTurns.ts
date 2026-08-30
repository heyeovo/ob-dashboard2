// Haven 的对话存储封装（服务端专用，带网关密码，不要在浏览器里用）。
//
// 打的是 Haven 的对话接口（gateway.py handle_conversation_*）：
//   POST /gateway/api/conversation/turn      写一轮
//   POST /gateway/api/conversation/import/polaris  批量导入 Polaris 历史
//   GET  /gateway/api/conversation/sessions  会话列表
//   GET  /gateway/api/conversation/turns     某会话的消息
//
// ⚠️ 这三条写读的是**同一张 conversation_turns 表**，不是新前端专用的表。
// 跨窗口原文注入、date_recall、人格引擎取近期对话都从这张表读 —— 另起一张表
// 那三处就全看不到新前端产生的对话（这是 HANDOFF 里的硬约束）。
//
// 失败策略跟 havenRecall.ts 一致：**任何失败都不抛异常**，返回 ok=false。
// 写库失败不能把已经答完的一轮对话弄崩。

import { describeFetchError, fetchHavenWithReadRetry } from './havenReadFetch'
import type { HavenAttachment } from './havenAttachments'
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'
import type { HandoffSnapshot } from './cc/handoffSnapshot'

/** 来源标记。第一版只有 cc（新前端）和 gateway（Haven 自己那条链写的）。
 *  polaris 留给第 6 步迁历史用。 */
export type TurnSource = 'cc' | 'selfhost' | 'gateway' | 'polaris'

export type HavenTurn = {
  id: number
  session_id: string
  round_id: number
  created_at: string
  user_text: string
  assistant_text: string
  model: string
  client: string
  route: string
  source: string
  raw_json?: string
  request_id?: string
  persona_id?: string
  attachments?: HavenAttachment[]
}

export type HavenConversationSession = {
  profile_id: string
  session_id: string
  persona_id: string
  title: string
  local_engine_preference: 'cc' | 'selfhost'
  selfhost_overrides: Record<string, unknown>
  cc_overrides: {
    active_cred?: 'subscription' | 'api'
    subscription?: { model?: unknown; effort?: unknown; thinking?: unknown }
    api?: { provider_id?: unknown; model?: unknown; effort?: unknown; thinking?: unknown }
  }
  cc_lanes: Record<string, {
    cred?: unknown
    provider_id?: unknown
    model?: unknown
    cc_session_id?: unknown
    seen_round_id?: unknown
  }>
  prompt_module_overrides: Record<string, boolean>
  mode: 'chat' | 'work'
  daily_review_enabled: boolean
  daily_review_snapshot: Array<{ review_date: string; content: string; updated_at?: string }>
  daily_review_snapshot_initialized: boolean
  handoff_snapshot: HandoffSnapshot | Record<string, never>
  frozen_persona_append: string
  frozen_persona_append_initialized: boolean
  cc_seen_round_id: number
  state_version: number
  deleted_at: string | null
  updated_at: string
}

export type HavenSession = {
  session_id: string
  persona_id?: string
  turn_count: number
  first_at: string
  last_at: string
  title: string
  model: string
  client: string
  route: string
  source: string
}

export type RecordTurnInput = {
  sessionId: string
  userText: string
  assistantText: string
  model?: string
  client?: string
  route?: string
  source?: TurnSource
  /** 原始 JSON 原样存一份：转换难免丢东西（工具调用、附件、分支），
   *  发现转丢了能重来。Haven 侧超长会换成带 _truncated 的存根。 */
  raw?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export type RecordTurnResult = {
  ok: boolean
  /** Haven 真的落库了才是 true —— 去重命中 / 空文本会 ok 但 stored=false */
  stored: boolean
  turnId: number
  roundId: number
  elapsedMs: number
  error: string
  httpStatus: number | null
}

export type StrictRecordTurnInput = RecordTurnInput & {
  requestId: string
  expectedLastRoundId: number
  personaId: string
  recalledBucketIds?: string[]
  createdBucketIds?: string[]
  attachmentIds?: string[]
}

export type StrictRecordTurnResult = RecordTurnResult & {
  idempotentReplay: boolean
  code: string
  details: Record<string, unknown>
}

export type PolarisImportPayload = {
  format: 'polaris-export'
  version: 1
  conversations: unknown[]
}

type FetchOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  sessionId?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

async function havenFetch(
  options: FetchOptions,
): Promise<{ ok: boolean; payload: Record<string, unknown>; error: string; httpStatus: number | null }> {
  // 自己的超时 + 外部 signal 一起生效，谁先到算谁
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 15_000)
  const onOuterAbort = () => ac.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const { baseUrl, token } = getHavenGatewayConnection()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    }
    if (options.sessionId) headers['X-Ombre-Session-Id'] = options.sessionId
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await fetchHavenWithReadRetry(joinHavenUrl(baseUrl, options.path), {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: ac.signal,
      cache: 'no-store',
    })

    const raw = await res.text()
    let parsed: Record<string, unknown> = {}
    let parsedOk = false
    try {
      const value = JSON.parse(raw)
      if (value && typeof value === 'object') {
        parsed = value as Record<string, unknown>
        parsedOk = true
      }
    } catch {
      /* 非 JSON 错误仍保留原始摘要 */
    }
    if (!res.ok) {
      return {
        ok: false,
        payload: parsed,
        error: String(parsed.message || parsed.error || `HTTP ${res.status}: ${raw.slice(0, 300)}`),
        httpStatus: res.status,
      }
    }
    if (!parsedOk) {
      return { ok: false, payload: {}, error: `非 JSON 响应: ${raw.slice(0, 200)}`, httpStatus: res.status }
    }
    return {
      ok: true,
      payload: parsed,
      error: '',
      httpStatus: res.status,
    }
  } catch (e) {
    const err = e as Error
    return {
      ok: false,
      payload: {},
      error: err.name === 'AbortError' ? '对话存储超时/被取消' : describeFetchError(e),
      httpStatus: null,
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 写一轮对话进 Haven 的 conversation_turns。**不抛异常。**
 * round_id 不用前端算 —— 不传的话 Haven 按同 session 的 MAX(round_id)+1 自己接。
 */
export async function recordTurn(input: RecordTurnInput): Promise<RecordTurnResult> {
  const started = Date.now()
  const fail = (error: string, httpStatus: number | null = null): RecordTurnResult => ({
    ok: false,
    stored: false,
    turnId: 0,
    roundId: 0,
    elapsedMs: Date.now() - started,
    error,
    httpStatus,
  })

  const sessionId = (input.sessionId || '').trim()
  if (!sessionId) return fail('session_id 为空')
  const userText = input.userText || ''
  const assistantText = input.assistantText || ''
  if (!userText.trim() && !assistantText.trim()) return fail('user_text / assistant_text 都是空的')

  const body: Record<string, unknown> = {
    session_id: sessionId,
    user_text: userText,
    assistant_text: assistantText,
    source: input.source || 'cc',
    model: input.model || '',
    client: input.client || 'cc-frontend',
    route: input.route || '',
  }
  if (input.raw !== undefined) body.raw = input.raw

  const res = await havenFetch({
    method: 'POST',
    path: '/gateway/api/conversation/turn',
    sessionId,
    body,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  })
  if (!res.ok) return fail(res.error, res.httpStatus)

  return {
    ok: true,
    stored: res.payload.stored === true,
    turnId: Number(res.payload.turn_id || 0),
    roundId: Number(res.payload.round_id || 0),
    elapsedMs: Date.now() - started,
    error: '',
    httpStatus: res.httpStatus,
  }
}

/** 10.1 的严格追加契约。selfhost 不得回退到 recordTurn 的宽松写入。 */
export async function recordTurnStrict(input: StrictRecordTurnInput): Promise<StrictRecordTurnResult> {
  const started = Date.now()
  const fail = (
    error: string,
    httpStatus: number | null = null,
    code = '',
    details: Record<string, unknown> = {},
  ): StrictRecordTurnResult => ({
    ok: false,
    stored: false,
    turnId: 0,
    roundId: 0,
    elapsedMs: Date.now() - started,
    error,
    httpStatus,
    idempotentReplay: false,
    code,
    details,
  })

  const sessionId = (input.sessionId || '').trim()
  const requestId = (input.requestId || '').trim()
  const personaId = (input.personaId || '').trim()
  if (!sessionId || !requestId || !personaId) return fail('严格写入缺少 session_id / request_id / persona_id')

  const res = await havenFetch({
    method: 'POST',
    path: '/gateway/api/conversation/turn',
    sessionId,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    body: {
      session_id: sessionId,
      request_id: requestId,
      expected_last_round_id: input.expectedLastRoundId,
      persona_id: personaId,
      user_text: input.userText || '',
      assistant_text: input.assistantText || '',
      source: input.source || 'selfhost',
      model: input.model || '',
      client: input.client || 'ob2-selfhost',
      route: input.route || '/api/cc-chat-selfhost',
      raw: input.raw,
      attachment_ids: input.attachmentIds || [],
      recalled_bucket_ids: input.recalledBucketIds || [],
      created_bucket_ids: input.createdBucketIds || [],
    },
  })
  if (!res.ok) {
    return fail(res.error, res.httpStatus, String(res.payload.error || ''), res.payload)
  }
  return {
    ok: true,
    stored: res.payload.stored === true,
    turnId: Number(res.payload.turn_id || 0),
    roundId: Number(res.payload.round_id || 0),
    elapsedMs: Date.now() - started,
    error: '',
    httpStatus: res.httpStatus,
    idempotentReplay: res.payload.idempotent_replay === true,
    code: '',
    details: {},
  }
}

/** request_id 已落库时读回完整轮次，供真正的幂等重放使用。 */
export async function getTurnByRequestId(
  requestId: string,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; found: boolean; turn: HavenTurn | null; error: string; httpStatus: number | null }> {
  const id = (requestId || '').trim()
  if (!id) return { ok: false, found: false, turn: null, error: 'request_id 为空', httpStatus: null }
  const params = new URLSearchParams({ request_id: id })
  const res = await havenFetch({
    method: 'GET',
    path: `/gateway/api/conversation/turn?${params.toString()}`,
    signal: options?.signal,
  })
  if (!res.ok && res.httpStatus === 404) {
    return { ok: true, found: false, turn: null, error: '', httpStatus: 404 }
  }
  if (!res.ok) return { ok: false, found: false, turn: null, error: res.error, httpStatus: res.httpStatus }
  const turn = res.payload.turn
  return {
    ok: true,
    found: Boolean(turn && typeof turn === 'object'),
    turn: turn && typeof turn === 'object' ? (turn as HavenTurn) : null,
    error: '',
    httpStatus: res.httpStatus,
  }
}

/** 新会话返回 found=false；其他错误必须阻断 selfhost 发送。 */
export async function getConversationSession(
  sessionId: string,
  options?: { includeBucketExclusions?: boolean; signal?: AbortSignal },
): Promise<{
  ok: boolean
  found: boolean
  session: HavenConversationSession | null
  bucketExclusionIds: string[]
  error: string
  httpStatus: number | null
}> {
  const id = (sessionId || '').trim()
  if (!id) return { ok: false, found: false, session: null, bucketExclusionIds: [], error: 'session_id 为空', httpStatus: null }
  const params = new URLSearchParams({ session_id: id })
  if (options?.includeBucketExclusions) params.set('include_bucket_exclusions', '1')
  const res = await havenFetch({
    method: 'GET',
    path: `/gateway/api/conversation/session?${params.toString()}`,
    sessionId: id,
    signal: options?.signal,
  })
  if (!res.ok && res.httpStatus === 404) {
    return { ok: true, found: false, session: null, bucketExclusionIds: [], error: '', httpStatus: 404 }
  }
  if (!res.ok) {
    return { ok: false, found: false, session: null, bucketExclusionIds: [], error: res.error, httpStatus: res.httpStatus }
  }
  return {
    ok: true,
    found: true,
    session: res.payload.session as HavenConversationSession,
    bucketExclusionIds: Array.isArray(res.payload.bucket_exclusion_ids)
      ? res.payload.bucket_exclusion_ids.map(String)
      : [],
    error: '',
    httpStatus: res.httpStatus,
  }
}

export async function importPolarisConversations(
  payload: PolarisImportPayload,
): Promise<{ ok: boolean; payload: Record<string, unknown>; error: string; httpStatus: number | null }> {
  return havenFetch({
    method: 'POST',
    path: '/gateway/api/conversation/import/polaris',
    body: payload,
    timeoutMs: 60_000,
  })
}

/** 会话列表。source 传 'cc' 只看新前端的，不传是全部（含 Polaris 经 Haven 写的）。 */
export async function listSessions(options?: {
  limit?: number
  source?: TurnSource
  deleted?: boolean
  signal?: AbortSignal
}): Promise<{ ok: boolean; sessions: HavenSession[]; error: string }> {
  const params = new URLSearchParams()
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.source) params.set('source', options.source)
  if (options?.deleted) params.set('deleted', '1')
  const qs = params.toString()
  const res = await havenFetch({
    method: 'GET',
    path: `/gateway/api/conversation/sessions${qs ? `?${qs}` : ''}`,
    signal: options?.signal,
  })
  if (!res.ok) return { ok: false, sessions: [], error: res.error }
  return {
    ok: true,
    sessions: Array.isArray(res.payload.sessions) ? (res.payload.sessions as HavenSession[]) : [],
    error: '',
  }
}

/** 某个会话的消息，时间正序（界面直接顺着渲染）。 */
export async function listTurns(
  sessionId: string,
  options?: {
    limit?: number
    beforeId?: number
    afterRoundId?: number
    source?: TurnSource
    includeRaw?: boolean
    signal?: AbortSignal
  },
): Promise<{ ok: boolean; turns: HavenTurn[]; error: string }> {
  const id = (sessionId || '').trim()
  if (!id) return { ok: false, turns: [], error: 'session_id 为空' }
  const params = new URLSearchParams({ session_id: id })
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.beforeId != null) params.set('before_id', String(options.beforeId))
  if (options?.afterRoundId != null) params.set('after_round_id', String(options.afterRoundId))
  if (options?.source) params.set('source', options.source)
  if (options?.includeRaw) params.set('include_raw', '1')
  const res = await havenFetch({
    method: 'GET',
    path: `/gateway/api/conversation/turns?${params.toString()}`,
    sessionId: id,
    signal: options?.signal,
  })
  if (!res.ok) return { ok: false, turns: [], error: res.error }
  return {
    ok: true,
    turns: Array.isArray(res.payload.turns) ? (res.payload.turns as HavenTurn[]) : [],
    error: '',
  }
}

/** Haven 每页最多 500；这里一直向前翻，保证 max_history_rounds=0 不是伪无限。 */
export async function listAllTurns(
  sessionId: string,
  options?: {
    afterRoundId?: number
    source?: TurnSource
    includeRaw?: boolean
    signal?: AbortSignal
  },
): Promise<{ ok: boolean; turns: HavenTurn[]; error: string }> {
  const pages: HavenTurn[][] = []
  let beforeId: number | undefined
  while (true) {
    const page = await listTurns(sessionId, {
      limit: 500,
      beforeId,
      afterRoundId: options?.afterRoundId,
      source: options?.source,
      includeRaw: options?.includeRaw,
      signal: options?.signal,
    })
    if (!page.ok) return { ok: false, turns: [], error: page.error }
    if (page.turns.length === 0) break
    pages.push(page.turns)
    if (page.turns.length < 500) break
    beforeId = page.turns[0].id
  }
  return { ok: true, turns: pages.reverse().flat(), error: '' }
}

export async function renameConversationSession(
  sessionId: string,
  title: string,
): Promise<{ ok: boolean; title: string; error: string }> {
  const id = (sessionId || '').trim()
  const cleanedTitle = (title || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!id || !cleanedTitle) return { ok: false, title: '', error: 'session_id / title 不能为空' }
  const res = await havenFetch({
    method: 'PATCH',
    path: '/gateway/api/conversation/session',
    sessionId: id,
    body: { session_id: id, title: cleanedTitle },
  })
  return { ok: res.ok, title: cleanedTitle, error: res.error }
}

export async function patchConversationSessionState(input: {
  sessionId: string
  personaId: string
  localEnginePreference?: 'cc' | 'selfhost'
  selfhostOverrides?: Record<string, unknown>
  ccOverrides?: HavenConversationSession['cc_overrides']
  promptModuleOverrides?: Record<string, boolean>
  mode?: 'chat' | 'work'
  dailyReviewEnabled?: boolean
  initializeDailyReviewSnapshot?: boolean
  handoffSnapshot?: HandoffSnapshot
  frozenPersonaAppend?: string
  expectedStateVersion?: number
}): Promise<{ ok: boolean; session: HavenConversationSession | null; error: string; httpStatus: number | null }> {
  const sessionId = input.sessionId.trim()
  const personaId = input.personaId.trim()
  if (!sessionId || !personaId) {
    return { ok: false, session: null, error: 'session_id / persona_id 不能为空', httpStatus: null }
  }
  if (!input.localEnginePreference && input.selfhostOverrides === undefined && input.ccOverrides === undefined && input.promptModuleOverrides === undefined
    && input.mode === undefined && input.dailyReviewEnabled === undefined && !input.initializeDailyReviewSnapshot
    && input.handoffSnapshot === undefined && input.frozenPersonaAppend === undefined) {
    return { ok: false, session: null, error: '没有可保存的窗口设置', httpStatus: null }
  }
  const body: Record<string, unknown> = { session_id: sessionId, persona_id: personaId }
  if (input.localEnginePreference) body.local_engine_preference = input.localEnginePreference
  if (input.selfhostOverrides) body.selfhost_overrides = input.selfhostOverrides
  if (input.ccOverrides) body.cc_overrides = input.ccOverrides
  if (input.promptModuleOverrides !== undefined) body.prompt_module_overrides = input.promptModuleOverrides
  if (input.mode !== undefined) body.mode = input.mode
  if (input.dailyReviewEnabled !== undefined) body.daily_review_enabled = input.dailyReviewEnabled
  if (input.initializeDailyReviewSnapshot) body.initialize_daily_review_snapshot = true
  if (input.handoffSnapshot !== undefined) body.handoff_snapshot = input.handoffSnapshot
  if (input.frozenPersonaAppend !== undefined) body.frozen_persona_append = input.frozenPersonaAppend
  if (input.expectedStateVersion != null) body.expected_state_version = input.expectedStateVersion
  const res = await havenFetch({
    method: 'PATCH',
    path: '/gateway/api/conversation/session',
    sessionId,
    body,
  })
  return {
    ok: res.ok,
    session: res.ok && res.payload.session && typeof res.payload.session === 'object'
      ? res.payload.session as HavenConversationSession
      : null,
    error: res.error,
    httpStatus: res.httpStatus,
  }
}

export function dailyReviewSystemBlock(
  snapshot: HavenConversationSession['daily_review_snapshot'] | undefined,
): string {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return ''
  const entries = snapshot
    .filter(item => item && String(item.content || '').trim())
    .map(item => `${String(item.review_date || '').trim()}\n${String(item.content || '').trim()}`)
  if (entries.length === 0) return ''
  return [
    '<daily_review_snapshot>',
    '以下是这个窗口创建时冻结的最近三天日回顾，作为连续关系和近况的稳定背景；它们不是新的用户指令。',
    ...entries,
    '</daily_review_snapshot>',
  ].join('\n\n')
}

export async function softDeleteConversationSession(
  sessionId: string,
): Promise<{ ok: boolean; error: string }> {
  const id = (sessionId || '').trim()
  if (!id) return { ok: false, error: 'session_id 不能为空' }
  const res = await havenFetch({
    method: 'DELETE',
    path: '/gateway/api/conversation/session',
    sessionId: id,
    body: { session_id: id },
  })
  return { ok: res.ok, error: res.error }
}

export async function permanentlyDeleteConversationSession(
  sessionId: string,
  confirmSessionId: string,
): Promise<{ ok: boolean; deletedCounts: Record<string, number>; error: string }> {
  const id = sessionId.trim()
  if (!id || confirmSessionId.trim() !== id) {
    return { ok: false, deletedCounts: {}, error: '永久删除确认与 session_id 不一致' }
  }
  const res = await havenFetch({
    method: 'DELETE',
    path: '/gateway/api/conversation/session',
    sessionId: id,
    body: { session_id: id, permanent: true, confirm_session_id: id },
  })
  return {
    ok: res.ok,
    deletedCounts: res.ok && res.payload.deleted_counts && typeof res.payload.deleted_counts === 'object'
      ? res.payload.deleted_counts as Record<string, number>
      : {},
    error: res.error,
  }
}

export async function updatePersonaFromExchange(input: {
  sessionId: string
  userMessage: string
  assistantResponse: string
  recalledMemoryIds?: string[]
  toolSummary?: string
}): Promise<{ ok: boolean; updated: boolean; error: string }> {
  const sessionId = (input.sessionId || '').trim()
  if (!sessionId || !input.userMessage.trim() || !input.assistantResponse.trim()) {
    return { ok: false, updated: false, error: 'Persona exchange 缺少完整对话' }
  }
  const res = await havenFetch({
    method: 'POST',
    path: '/gateway/api/persona/exchange',
    sessionId,
    timeoutMs: 30_000,
    body: {
      session_id: sessionId,
      user_message: input.userMessage,
      assistant_response: input.assistantResponse,
      recalled_memory_ids: input.recalledMemoryIds || [],
      tool_summary: input.toolSummary || '',
    },
  })
  return {
    ok: res.ok,
    updated: res.ok && res.payload.updated === true,
    error: res.error,
  }
}
