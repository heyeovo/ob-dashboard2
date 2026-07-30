// CC 永久工具权限（服务端专用）。
//
// 长期规则存 Haven 的 /gateway/api/cc/permissions；浏览器和本地文件都不持久化。
// 这里只接受 Bash / WebFetch 的细粒度 allow 规则，空 ruleContent 一律丢弃，
// 避免误生成“所有 Bash 永久放行”。
import {
  DEFAULT_WEB_SETTINGS,
  normalizeWebSettings,
  webSettingsToHaven,
  type CcWebSettings,
} from '@/app/cc/webSettings'

const HAVEN_BASE = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
).replace(/\/+$/, '')

const GATEWAY_TOKEN = process.env.OMBRE_GATEWAY_TOKEN || ''
const PATH = '/gateway/api/cc/permissions'
const MAX_RULES = 100
const MAX_RULE_CHARS = 500
const PERSISTABLE_TOOLS = new Set(['Bash', 'WebFetch'])

export type CcPermissionRule = {
  toolName: 'Bash' | 'WebFetch'
  ruleContent: string
}

export type CcPermissionConfig = {
  allow?: CcPermissionRule[]
  web?: Record<string, unknown>
  updated_at?: string
}

function normalizeRule(input: unknown): CcPermissionRule | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const toolName = String(raw.toolName ?? raw.tool_name ?? '').trim()
  const ruleContent = String(raw.ruleContent ?? raw.rule_content ?? '').trim()
  if (!PERSISTABLE_TOOLS.has(toolName) || !ruleContent || ruleContent.length > MAX_RULE_CHARS) {
    return null
  }
  return { toolName: toolName as CcPermissionRule['toolName'], ruleContent }
}

export function normalizePermissionRules(input: unknown): CcPermissionRule[] {
  if (!Array.isArray(input)) return []
  const out: CcPermissionRule[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const rule = normalizeRule(item)
    if (!rule) continue
    const key = `${rule.toolName}\u0000${rule.ruleContent}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rule)
    if (out.length >= MAX_RULES) break
  }
  return out
}

async function havenFetch(
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; payload: Record<string, unknown>; error: string }> {
  if (!GATEWAY_TOKEN) {
    return { ok: false, payload: {}, error: 'OMBRE_GATEWAY_TOKEN 未配置，永久权限无法读取或保存' }
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${GATEWAY_TOKEN}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${HAVEN_BASE}${PATH}`, {
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
  } catch (error) {
    const err = error as Error
    return {
      ok: false,
      payload: {},
      error: err.name === 'AbortError' ? '永久权限请求超时' : String(err.message || err),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function loadPermanentPermissionRules(): Promise<{
  ok: boolean
  rules: CcPermissionRule[]
  error: string
}> {
  const res = await havenFetch('GET')
  if (!res.ok) return { ok: false, rules: [], error: res.error }
  const config =
    res.payload.config && typeof res.payload.config === 'object'
      ? (res.payload.config as Record<string, unknown>)
      : {}
  return { ok: true, rules: normalizePermissionRules(config.allow), error: '' }
}

async function loadPermissionConfig(): Promise<{
  ok: boolean
  rules: CcPermissionRule[]
  web: CcWebSettings
  error: string
}> {
  const res = await havenFetch('GET')
  if (!res.ok) {
    return { ok: false, rules: [], web: DEFAULT_WEB_SETTINGS, error: res.error }
  }
  const config =
    res.payload.config && typeof res.payload.config === 'object'
      ? (res.payload.config as Record<string, unknown>)
      : {}
  return {
    ok: true,
    rules: normalizePermissionRules(config.allow),
    web: normalizeWebSettings(
      config.web && typeof config.web === 'object'
        ? (config.web as Record<string, unknown>)
        : {},
    ),
    error: '',
  }
}

export async function loadWebSettings(): Promise<{
  ok: boolean
  settings: CcWebSettings
  error: string
}> {
  const config = await loadPermissionConfig()
  return { ok: config.ok, settings: config.web, error: config.error }
}

export async function saveWebSettings(
  input: Record<string, unknown>,
): Promise<{ ok: boolean; settings: CcWebSettings; error: string }> {
  const existing = await loadPermissionConfig()
  if (!existing.ok) return { ok: false, settings: existing.web, error: existing.error }
  const settings = normalizeWebSettings(input)
  const res = await havenFetch('POST', {
    allow: existing.rules,
    web: webSettingsToHaven(settings),
  })
  if (!res.ok) return { ok: false, settings: existing.web, error: res.error }
  const config =
    res.payload.config && typeof res.payload.config === 'object'
      ? (res.payload.config as Record<string, unknown>)
      : {}
  return {
    ok: true,
    settings: normalizeWebSettings(
      config.web && typeof config.web === 'object'
        ? (config.web as Record<string, unknown>)
        : {},
    ),
    error: '',
  }
}

export async function addPermanentPermissionRules(
  incoming: unknown,
): Promise<{ ok: boolean; rules: CcPermissionRule[]; error: string }> {
  const additions = normalizePermissionRules(incoming)
  if (additions.length === 0) {
    return { ok: false, rules: [], error: 'SDK 没有给出可安全永久保存的细粒度规则' }
  }

  const existing = await loadPermissionConfig()
  if (!existing.ok) return existing
  const merged = normalizePermissionRules([...existing.rules, ...additions])
  const res = await havenFetch('POST', {
    allow: merged,
    web: webSettingsToHaven(existing.web),
  })
  if (!res.ok) return { ok: false, rules: existing.rules, error: res.error }
  const config =
    res.payload.config && typeof res.payload.config === 'object'
      ? (res.payload.config as Record<string, unknown>)
      : {}
  return { ok: true, rules: normalizePermissionRules(config.allow), error: '' }
}

export function permissionRuleStrings(rules: CcPermissionRule[]): string[] {
  return rules.map(rule => `${rule.toolName}(${rule.ruleContent})`)
}
