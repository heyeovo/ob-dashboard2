import { NextRequest } from 'next/server'
import { redactHavenSecrets } from '@/app/lib/havenConfig'
import { gptGateway } from '@/app/lib/gptSubscription/transport'
import type { GptConnectionError, GptConnectionResponse, GptConnectionStatus,
  GptConnectionsResponse, GptModelsResponse } from '@/app/lib/gptSubscription/contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ operation: string }> }
type PublicResponse = GptConnectionResponse | GptConnectionsResponse | GptModelsResponse
const USAGE_URL = 'https://chatgpt.com/settings/usage'
const OPERATIONS = new Set(['connection', 'connections', 'models'])
const STATUSES = new Set(['disconnected', 'connecting', 'connected', 'reauth_required'])
const ACTIONS = new Set(['reconnect', 'usage_settings', 'enable_sharing', 'retry', 'inspect'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown, limit = 200) {
  if (typeof value !== 'string') return ''
  return redactHavenSecrets(value)
    .replace(/Bearer\s+\S+|\b(?:sk-|rt-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/gi, '[redacted]')
    .replace(/([^\s@])[^\s@]*@[^\s@]+/g, '$1***').slice(0, limit)
}
function identifier(value: unknown) {
  const safe = text(value, 100)
  return typeof value === 'string' && safe === value && /^[A-Za-z0-9_-]{1,100}$/.test(safe) ? safe : ''
}
function publicError(value: unknown, fallback = 'gateway_error'): GptConnectionError {
  const source = record(value)
  const code = typeof source.code === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(source.code)
    && text(source.code) === source.code ? source.code : fallback
  const action = ACTIONS.has(String(source.action)) ? source.action as GptConnectionError['action'] : 'inspect'
  // Never forward upstream exception text, diagnostic objects or request headers.
  const message = action === 'reconnect' ? 'GPT 授权已失效，请重新连接'
    : action === 'usage_settings' ? 'GPT 订阅共享额度不足，请到 ChatGPT 用量设置查看'
      : action === 'enable_sharing' ? '请先在 ChatGPT 中开启订阅共享'
        : action === 'retry' ? 'GPT 服务暂时不可用，请稍后重试' : 'GPT 连接或配置异常，请检查服务端状态'
  return { code, message, retryable: source.retryable === true, action,
    ...(Number.isInteger(source.status) && Number(source.status) >= 400 && Number(source.status) <= 599
      ? { status: Number(source.status) } : {}) }
}
function json(body: PublicResponse, status = 200, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
function failure(code: string, status: number) {
  return json({ ok: false, error: publicError({ code, retryable: status >= 500, action: status >= 500 ? 'retry' : 'inspect' }) }, status)
}

function project(operation: string, value: unknown): PublicResponse {
  const b = record(value)
  if (b.ok === false) return { ok: false, error: publicError(b.error) }
  if (b.ok !== true) throw new Error('invalid_gateway_response')
  if (operation === 'connection') {
    if (!STATUSES.has(String(b.status)) || typeof b.configured !== 'boolean' || typeof b.sharing !== 'boolean') throw new Error('invalid_gateway_response')
    const id = identifier(b.connection_id)
    return { ok: true, configured: b.configured, status: b.status as GptConnectionStatus, sharing: b.sharing,
      login_method: 'local_ssh_import', limits: null, usage_url: USAGE_URL,
      ...(id ? { connection_id: id } : {}), ...(typeof b.label === 'string' ? { label: text(b.label) } : {}),
      ...(typeof b.account === 'string' && b.account ? { account: `${Array.from(text(b.account))[0] || '*'}***` } : {}),
      ...(b.error ? { error: publicError(b.error) } : {}) }
  }
  if (operation === 'connections') {
    if (!Array.isArray(b.connections) || b.connections.length > 1000) throw new Error('invalid_gateway_response')
    return { ok: true, connections: b.connections.map(value => {
      const item = record(value), id = identifier(item.connection_id)
      if (!id || !STATUSES.has(String(item.status)) || typeof item.sharing !== 'boolean') throw new Error('invalid_gateway_response')
      return { connection_id: id, label: text(item.label), status: item.status as GptConnectionStatus, sharing: item.sharing }
    }) }
  }
  if (!Array.isArray(b.models) || b.models.length > 1000) throw new Error('invalid_gateway_response')
  return { ok: true, models: b.models.map(value => {
    const item = record(value)
    const slug = text(item.slug), displayName = text(item.displayName)
    if (!slug || typeof item.slug !== 'string' || slug !== item.slug) throw new Error('invalid_gateway_response')
    return { slug, displayName: displayName || slug }
  }) }
}

async function relay(operation: string, body?: unknown) {
  try {
    // Browser Cookie auth is enforced by proxy.ts; only the server supplies the Gateway Bearer.
    const upstream = await gptGateway(operation, body)
    const projected = project(operation, await upstream.json())
    if (!upstream.ok && projected.ok) return failure('invalid_gateway_response', 502)
    return json(projected, upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 200)
  } catch { return failure('gateway_unavailable', 502) }
}

export async function GET(_request: NextRequest, context: Context) {
  const { operation } = await context.params
  return OPERATIONS.has(operation) ? relay(operation) : failure('unsupported_endpoint', 404)
}

export async function POST(request: NextRequest, context: Context) {
  const { operation } = await context.params
  if (!OPERATIONS.has(operation)) return failure('unsupported_endpoint', 404)
  if (operation !== 'connection') return json({ ok: false, error: publicError({ code: 'method_not_allowed' }) }, 405, { Allow: 'GET' })
  let b: Record<string, unknown>
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 4096) return failure('invalid_request', 413)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('invalid_request', 400)
    b = record(parsed)
  } catch { return failure('invalid_request', 400) }
  if (b.action === 'disconnect' && Object.keys(b).length === 1) return relay(operation, { action: 'disconnect' })
  const id = identifier(b.connection_id)
  if (b.action === 'select' && id && Object.keys(b).length === 2) return relay(operation, { action: 'select', connection_id: id })
  return failure('invalid_request', 400)
}
