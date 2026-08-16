// Haven 的 hook 召回接口封装（服务端专用，带网关密码，不要在浏览器里用）。
//
// 打的是 Haven 的 POST /gateway/api/hook/recall（gateway.py:2334 handle_hook_recall）。
// 那条路走 _hook_recall_fast_cards，跟 /v1/messages 那条注入路径是两套实现。
//
// ⚠️ 三个 allow_* 默认是关的（只做关键词匹配、不跑向量检索），必须显式传 "1"，
// 否则语义命中的桶会全部返回 0 张卡，看起来像门控在拦。开了单次 4-6 秒。
// ⚠️ 已知缺口：这条路没有 date_recall，「昨天我们聊了什么」拿不到东西（第 2.5 步的活）。
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'

export type HavenRecallResult = {
  ok: boolean
  /** 拼好的注入正文，直接塞进 hook 的 additionalContext */
  additionalContext: string
  cardCount: number
  chars: number
  elapsedMs: number
  recalledIds: string[]
  domains: string[]
  /** ok=false 时的原因；ok=true 时为空 */
  error: string
  httpStatus: number | null
  debug?: unknown
}

export type HavenRecallOptions = {
  sessionId: string
  /** 打开语义检索 / rerank / query planner。默认 true。 */
  semantic?: boolean
  /** 要 Haven 回完整 debug，排查时用 */
  includeDebug?: boolean
  maxNotes?: number
  maxChars?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** 已在上下文中的桶 ID，Haven 会跳过不再返回 */
  excludeIds?: string[]
}

/**
 * 查一次记忆召回。**任何失败都不抛异常** —— 返回 ok=false。
 * hook 里绝不能因为 Haven 抽风就把整轮对话弄崩。
 */
export async function recallForPrompt(
  query: string,
  options: HavenRecallOptions,
): Promise<HavenRecallResult> {
  const started = Date.now()
  const fail = (error: string, httpStatus: number | null = null): HavenRecallResult => ({
    ok: false,
    additionalContext: '',
    cardCount: 0,
    chars: 0,
    elapsedMs: Date.now() - started,
    recalledIds: [],
    domains: [],
    error,
    httpStatus,
  })

  const text = (query || '').trim()
  if (!text) return fail('empty query')

  const semantic = options.semantic !== false
  const body: Record<string, unknown> = {
    query: text,
    session_id: options.sessionId,
  }
  if (semantic) {
    // 三个都要显式传字符串 "1"，Haven 侧用 _truthy_header 解析
    body.allow_semantic = '1'
    body.allow_rerank = '1'
    body.allow_query_planner = '1'
  }
  if (options.includeDebug) body.include_debug = '1'
  if (options.maxNotes != null) body.max_notes = options.maxNotes
  if (options.maxChars != null) body.max_chars = options.maxChars
  if (options.excludeIds && options.excludeIds.length > 0) {
    body.exclude_ids = options.excludeIds
  }

  // 自己的超时 + 外部 signal 一起生效，谁先到算谁
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 20_000)
  const onOuterAbort = () => ac.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const { baseUrl, token } = getHavenGatewayConnection()
    const res = await fetch(joinHavenUrl(baseUrl, '/gateway/api/hook/recall'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Ombre-Session-Id': options.sessionId,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
      cache: 'no-store',
    })

    const raw = await res.text()
    if (!res.ok) return fail(`HTTP ${res.status}: ${raw.slice(0, 300)}`, res.status)

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return fail(`非 JSON 响应: ${raw.slice(0, 200)}`, res.status)
    }

    const additionalContext = String(payload.additional_context || '')
    const cards = Array.isArray(payload.cards) ? payload.cards : []
    const debug = (payload.debug || {}) as Record<string, unknown>

    return {
      ok: true,
      additionalContext,
      cardCount: cards.length,
      chars: additionalContext.length,
      elapsedMs: Date.now() - started,
      recalledIds: Array.isArray(payload.recalled_ids)
        ? payload.recalled_ids.map(String)
        : [],
      domains: Array.isArray(debug.domains) ? debug.domains.map(String) : [],
      error: '',
      httpStatus: res.status,
      debug: options.includeDebug ? debug : undefined,
    }
  } catch (e) {
    const err = e as Error
    return fail(err.name === 'AbortError' ? '召回超时/被取消' : String(err.message || err))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}
