// Haven 的协作者配置封装（服务端专用，带网关密码，不要在浏览器里用）。
//
// 打的是 Haven 的一条新接口（gateway.py handle_cc_personas_*）：
//   GET    /gateway/api/cc/personas   列全部
//   POST   /gateway/api/cc/personas   upsert 一个（PATCH 语义：只送的字段才改）
//   DELETE /gateway/api/cc/personas?id=xxx
//
// ⚠️ 为什么存 Haven 不存浏览器：localStorage 按设备+浏览器各存一份 = 复刻 Polaris
// 那个「手机和 PC 两份数据」的坑。存 Haven 之后所有入口读同一份。
//
// 失败策略跟 havenTurns.ts 一致：**任何失败都不抛异常**，返回 ok=false。
// 配置读不到时前端退回内置默认协作者，不能让聊天页整个白屏。

const HAVEN_BASE = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
).replace(/\/+$/, '')

// 网关密码，跟看板登录密码 OMBRE_SESSION 不是同一个
const GATEWAY_TOKEN = process.env.OMBRE_GATEWAY_TOKEN || ''

const PATH = '/gateway/api/cc/personas'

/** 引擎（= 额度 + 请求拼装归谁）。selfhost 是第 7 步的自建引擎，界面里灰着。 */
export type CcEngine = 'subscription' | 'api' | 'selfhost'

/** Haven 返回的一条协作者（snake_case 原样带出，前端在 app/cc 里转驼峰）。 */
export type HavenPersona = {
  id: string
  name: string
  initial: string
  tint: string
  user_name: string
  purpose: string
  description: string
  prompt: string
  memory_entries: string[]
  /** 能读哪些目录。第一个当 cwd，其余作附加目录。空 = 用默认（仓库根） */
  dirs: string[]
  recall_on: boolean
  semantic_on: boolean
  engine: string
  sort_order: number
  created_at: string
  updated_at: string
}

/** upsert 的载荷。除 id 以外全是可选 —— 不送的字段 Haven 保持原值。 */
export type PersonaPatch = {
  id: string
  name?: string
  initial?: string
  tint?: string
  user_name?: string
  purpose?: string
  description?: string
  prompt?: string
  memory_entries?: string[]
  dirs?: string[]
  recall_on?: boolean
  semantic_on?: boolean
  engine?: CcEngine
  sort_order?: number
}

type FetchOptions = {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
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
      error: 'OMBRE_GATEWAY_TOKEN 未配置（.env.local），协作者配置会被 Haven 401',
      httpStatus: null,
    }
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 15_000)
  const onOuterAbort = () => ac.abort()
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
    }
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
      return { ok: true, payload: JSON.parse(raw) as Record<string, unknown>, error: '', httpStatus: res.status }
    } catch {
      return { ok: false, payload: {}, error: `非 JSON 响应: ${raw.slice(0, 200)}`, httpStatus: res.status }
    }
  } catch (e) {
    const err = e as Error
    return {
      ok: false,
      payload: {},
      error: err.name === 'AbortError' ? '协作者配置请求超时/被取消' : String(err.message || err),
      httpStatus: null,
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onOuterAbort)
  }
}

export async function listPersonas(options?: {
  signal?: AbortSignal
}): Promise<{ ok: boolean; personas: HavenPersona[]; error: string }> {
  const res = await havenFetch({ method: 'GET', path: PATH, signal: options?.signal })
  if (!res.ok) return { ok: false, personas: [], error: res.error }
  return {
    ok: true,
    personas: Array.isArray(res.payload.personas) ? (res.payload.personas as HavenPersona[]) : [],
    error: '',
  }
}

export async function savePersona(
  patch: PersonaPatch,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; persona: HavenPersona | null; error: string }> {
  const id = (patch.id || '').trim()
  if (!id) return { ok: false, persona: null, error: 'id 为空' }
  const res = await havenFetch({
    method: 'POST',
    path: PATH,
    body: { ...patch, id },
    signal: options?.signal,
  })
  if (!res.ok) return { ok: false, persona: null, error: res.error }
  const persona = res.payload.persona
  return {
    ok: true,
    persona: persona && typeof persona === 'object' ? (persona as HavenPersona) : null,
    error: '',
  }
}

export async function deletePersona(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; deleted: boolean; error: string }> {
  const safeId = (id || '').trim()
  if (!safeId) return { ok: false, deleted: false, error: 'id 为空' }
  const res = await havenFetch({
    method: 'DELETE',
    path: `${PATH}?id=${encodeURIComponent(safeId)}`,
    signal: options?.signal,
  })
  if (!res.ok) return { ok: false, deleted: false, error: res.error }
  return { ok: true, deleted: res.payload.deleted === true, error: '' }
}

/** 按 id 取一个。Haven 那边没有单条接口，直接从列表里挑。 */
export async function getPersona(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; persona: HavenPersona | null; error: string }> {
  const safeId = (id || '').trim()
  const res = await listPersonas(options)
  if (!res.ok) return { ok: false, persona: null, error: res.error }
  const hit = safeId
    ? res.personas.find(p => p.id === safeId) || null
    : res.personas[0] || null
  return { ok: true, persona: hit, error: hit ? '' : '没有这个协作者' }
}

/**
 * 协作者配置 → systemPrompt.append 的那段文字。
 *
 * ⚠️ 只能走 append，**绝不能**拼进用户那句话里。第 2 步实测过反向效应：
 * 用户 prompt 越长，语义分越低、记忆召回越差（discriminative_anchor_missing），
 * 往原话里塞前缀会把召回压到 0 条。
 */
export function buildPersonaAppend(persona: HavenPersona | null): string {
  if (!persona) return ''
  const parts: string[] = []
  const name = (persona.name || '').trim()
  if (name) parts.push(`你在这个对话里的名字是「${name}」。`)
  const userName = (persona.user_name || '').trim()
  if (userName) parts.push(`称呼对方为「${userName}」。`)
  const purpose = (persona.purpose || '').trim()
  if (purpose) parts.push(`你的定位：\n${purpose}`)
  const prompt = (persona.prompt || '').trim()
  if (prompt) parts.push(prompt)
  const entries = (persona.memory_entries || []).map(e => String(e).trim()).filter(Boolean)
  if (entries.length) {
    parts.push(`以下是关于对方的固定事实，始终成立：\n${entries.map(e => `- ${e}`).join('\n')}`)
  }
  return parts.join('\n\n')
}
