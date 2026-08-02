// Haven 的上游模型配置封装（服务端专用，带网关密码，不要在浏览器里用）。
//
//   GET  /gateway/api/cc/upstream   读整份
//   POST /gateway/api/cc/upstream   整份覆盖
//
// 失败策略跟 havenPersonas.ts 一致：不抛异常，返回 ok=false + 空配置。
// 配置读不到时引擎层退回 .env.local 那一条，不能让聊天页发不了话。

import { describeFetchError, fetchHavenWithReadRetry } from './havenReadFetch'

const HAVEN_BASE = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
).replace(/\/+$/, '')

const GATEWAY_TOKEN = process.env.OMBRE_GATEWAY_TOKEN || ''
const PATH = '/gateway/api/cc/upstream'

/** Haven 存的一个中转站（snake_case 原样带出，前端在 app/cc/upstream.ts 转驼峰）。 */
export type HavenProvider = {
  id: string
  label: string
  base_url: string
  token: string
  models: string[]
}

export type HavenUpstreamConfig = {
  providers?: HavenProvider[]
  subscription_models?: string[]
  default_kind?: string
  default_provider_id?: string
  default_model?: string
  default_effort?: string
  default_thinking?: boolean
  updated_at?: string
}

async function havenFetch(
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; payload: Record<string, unknown>; error: string }> {
  if (!GATEWAY_TOKEN) {
    return {
      ok: false,
      payload: {},
      error: 'OMBRE_GATEWAY_TOKEN 未配置（.env.local），上游模型配置会被 Haven 401',
    }
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${GATEWAY_TOKEN}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetchHavenWithReadRetry(`${HAVEN_BASE}${PATH}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
      cache: 'no-store',
    })
    const raw = await res.text()
    if (!res.ok) return { ok: false, payload: {}, error: `HTTP ${res.status}: ${raw.slice(0, 300)}` }
    try {
      return { ok: true, payload: JSON.parse(raw) as Record<string, unknown>, error: '' }
    } catch {
      return { ok: false, payload: {}, error: `非 JSON 响应: ${raw.slice(0, 200)}` }
    }
  } catch (e) {
    const err = e as Error
    return {
      ok: false,
      payload: {},
      error: err.name === 'AbortError' ? '上游模型配置请求超时' : describeFetchError(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function loadUpstreamConfig(): Promise<{
  ok: boolean
  config: HavenUpstreamConfig
  error: string
}> {
  const res = await havenFetch('GET')
  if (!res.ok) return { ok: false, config: {}, error: res.error }
  const config = res.payload.config
  return {
    ok: true,
    config: config && typeof config === 'object' ? (config as HavenUpstreamConfig) : {},
    error: '',
  }
}

export async function saveUpstreamConfig(
  config: Record<string, unknown>,
): Promise<{ ok: boolean; config: HavenUpstreamConfig; error: string }> {
  const res = await havenFetch('POST', config)
  if (!res.ok) return { ok: false, config: {}, error: res.error }
  const saved = res.payload.config
  return {
    ok: true,
    config: saved && typeof saved === 'object' ? (saved as HavenUpstreamConfig) : {},
    error: '',
  }
}

/**
 * 解析出「这个窗口该用什么凭据 + 哪个模型」。
 *
 * ⚠️ 前端送来的 provider_id 在服务端翻成 baseUrl / token —— **token 不下发到浏览器**。
 * /api/cc-upstream 那条读接口会把 token 打码，只有这里（服务端）拿真值。
 */
export function resolveProvider(
  config: HavenUpstreamConfig,
  providerId: string,
): { providerId: string; baseUrl: string; authToken: string; label: string } | null {
  const list = Array.isArray(config.providers) ? config.providers : []
  const hit =
    list.find(p => String(p.id || '') === providerId) ||
    (providerId ? null : list.find(p => String(p.id || '') === String(config.default_provider_id || '')) || list[0])
  if (!hit || !hit.base_url) return null
  return {
    providerId: String(hit.id || ''),
    baseUrl: String(hit.base_url),
    authToken: String(hit.token || ''),
    label: String(hit.label || ''),
  }
}

/** 把 token 换成掩码，给浏览器看。 */
export function maskUpstreamConfig(config: HavenUpstreamConfig): HavenUpstreamConfig {
  const list = Array.isArray(config.providers) ? config.providers : []
  return {
    ...config,
    providers: list.map(p => ({
      ...p,
      token: p.token ? `${String(p.token).slice(0, 6)}••••` : '',
    })),
  }
}
