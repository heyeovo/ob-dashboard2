// Haven 的对话存储封装（服务端专用，带网关密码，不要在浏览器里用）。
//
// 打的是 Haven 的三条新接口（gateway.py handle_conversation_*）：
//   POST /gateway/api/conversation/turn      写一轮
//   GET  /gateway/api/conversation/sessions  会话列表
//   GET  /gateway/api/conversation/turns     某会话的消息
//
// ⚠️ 这三条写读的是**同一张 conversation_turns 表**，不是新前端专用的表。
// 跨窗口原文注入、date_recall、人格引擎取近期对话都从这张表读 —— 另起一张表
// 那三处就全看不到新前端产生的对话（这是 HANDOFF 里的硬约束）。
//
// 失败策略跟 havenRecall.ts 一致：**任何失败都不抛异常**，返回 ok=false。
// 写库失败不能把已经答完的一轮对话弄崩。

const HAVEN_BASE = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
).replace(/\/+$/, '')

// 网关密码，跟看板登录密码 OMBRE_SESSION 不是同一个
const GATEWAY_TOKEN = process.env.OMBRE_GATEWAY_TOKEN || ''

/** 来源标记。第一版只有 cc（新前端）和 gateway（Haven 自己那条链写的）。
 *  polaris 留给第 6 步迁历史用。 */
export type TurnSource = 'cc' | 'gateway' | 'polaris'

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
}

export type HavenSession = {
  session_id: string
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
  if (!GATEWAY_TOKEN) {
    return {
      ok: false,
      payload: {},
      error: 'OMBRE_GATEWAY_TOKEN 未配置（.env.local），对话存储会被 Haven 401',
      httpStatus: null,
    }
  }

  // 自己的超时 + 外部 signal 一起生效，谁先到算谁
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 15_000)
  const onOuterAbort = () => ac.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
    }
    if (options.sessionId) headers['X-Ombre-Session-Id'] = options.sessionId
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await fetch(`${HAVEN_BASE}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: ac.signal,
      cache: 'no-store',
    })

    const raw = await res.text()
    if (!res.ok) {
      return { ok: false, payload: {}, error: `HTTP ${res.status}: ${raw.slice(0, 300)}`, httpStatus: res.status }
    }
    try {
      return {
        ok: true,
        payload: JSON.parse(raw) as Record<string, unknown>,
        error: '',
        httpStatus: res.status,
      }
    } catch {
      return { ok: false, payload: {}, error: `非 JSON 响应: ${raw.slice(0, 200)}`, httpStatus: res.status }
    }
  } catch (e) {
    const err = e as Error
    return {
      ok: false,
      payload: {},
      error: err.name === 'AbortError' ? '对话存储超时/被取消' : String(err.message || err),
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

/** 会话列表。source 传 'cc' 只看新前端的，不传是全部（含 Polaris 经 Haven 写的）。 */
export async function listSessions(options?: {
  limit?: number
  source?: TurnSource
  signal?: AbortSignal
}): Promise<{ ok: boolean; sessions: HavenSession[]; error: string }> {
  const params = new URLSearchParams()
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.source) params.set('source', options.source)
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
  options?: { limit?: number; beforeId?: number; includeRaw?: boolean; signal?: AbortSignal },
): Promise<{ ok: boolean; turns: HavenTurn[]; error: string }> {
  const id = (sessionId || '').trim()
  if (!id) return { ok: false, turns: [], error: 'session_id 为空' }
  const params = new URLSearchParams({ session_id: id })
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.beforeId != null) params.set('before_id', String(options.beforeId))
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
