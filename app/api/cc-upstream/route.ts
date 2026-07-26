import { NextRequest } from 'next/server'
import {
  loadUpstreamConfig,
  maskUpstreamConfig,
  saveUpstreamConfig,
  type HavenProvider,
} from '@/app/lib/havenUpstream'

// 5.2 上游模型配置。代理到 Haven 的 /gateway/api/cc/upstream。
//
//   GET  /api/cc-upstream   → 整份配置，**token 打码**
//   POST /api/cc-upstream   → 整份覆盖
//
// ⚠️ 两条安全约束：
//   1. 网关密码留在服务端，浏览器只跟这条路由说话。
//   2. 中转站 token 不下发浏览器。GET 回的是 `sk-abc••••`，
//      POST 送回来的如果还是那个掩码，就保留库里的原值 —— 不然用户在
//      「上游模型」页改个模型名就会把 token 覆盖成掩码字符串。

export const runtime = 'nodejs'

const MASK_SUFFIX = '••••'

export async function GET() {
  const res = await loadUpstreamConfig()
  if (!res.ok) return Response.json({ ok: false, error: res.error, config: {} }, { status: 502 })
  return Response.json({ ok: true, config: maskUpstreamConfig(res.config) })
}

/** 掩码换回真 token。空串也当「没改」，避免误清。要清 token 就删掉整个中转站。 */
function restoreToken(incoming: string, stored: string): string {
  const value = (incoming || '').trim()
  if (!value) return stored
  if (value.endsWith(MASK_SUFFIX)) return stored
  return value
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ ok: false, error: '请求体不是对象' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const existing = await loadUpstreamConfig()
  const storedById = new Map<string, string>()
  for (const p of existing.config.providers || []) {
    storedById.set(String(p.id || ''), String(p.token || ''))
  }

  const rawProviders = Array.isArray(input.providers) ? (input.providers as Record<string, unknown>[]) : []
  const providers: HavenProvider[] = []
  for (const [i, p] of rawProviders.entries()) {
    const id = String(p.id || '').trim() || `pv-${i}`
    const baseUrl = String(p.base_url ?? p.baseUrl ?? '').trim()
    if (!baseUrl) continue
    providers.push({
      id,
      label: String(p.label || '').trim() || `中转站 ${i + 1}`,
      base_url: baseUrl,
      token: restoreToken(String(p.token ?? ''), storedById.get(id) || ''),
      models: Array.isArray(p.models)
        ? p.models.map(m => String(m ?? '').trim()).filter(Boolean)
        : [],
    })
  }

  const payload = {
    providers,
    subscription_models: Array.isArray(input.subscription_models)
      ? input.subscription_models.map(m => String(m ?? '').trim()).filter(Boolean)
      : [],
    default_kind: input.default_kind === 'subscription' ? 'subscription' : 'api',
    default_provider_id: String(input.default_provider_id ?? '').trim(),
    default_model: String(input.default_model ?? '').trim(),
    default_effort: String(input.default_effort ?? 'high'),
    default_thinking: input.default_thinking !== false,
  }

  const res = await saveUpstreamConfig(payload)
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })
  return Response.json({ ok: true, config: maskUpstreamConfig(res.config) })
}
