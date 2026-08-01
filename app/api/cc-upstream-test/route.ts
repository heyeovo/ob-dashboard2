import { NextRequest } from 'next/server'
import { loadUpstreamConfig, resolveProvider } from '@/app/lib/havenUpstream'
import { anthropicHeaders, candidateAnthropicUrls } from '@/app/lib/selfhost/anthropicMessages'

// 「这个中转站的这个模型通不通」（5.2）。
//
//   POST /api/cc-upstream-test   body: { provider_id, model }
//
// 为什么要真发一次请求：中转站的 /v1/models 大多是假的（照抄官方列表），
// 只有真发一句才知道这个模型名在这个站上能不能用。所以**会花掉几个 token**，
// 界面上写了这句话。max_tokens: 1，成本可以忽略。
//
// ⚠️ token 只在服务端出现 —— 前端送的是 provider_id，真值从 Haven 那份配置里取。
// ⚠️ 同一个站不同模型的通断情况经常不一样（有的模型没上架 / 余额分池），
//    所以按「站 × 模型」测，不是按站测。
//
// 订阅侧（本机 claude 登录态）测不了：凭据在 claude code 自己手里，
// 这里没有可用的 key。前端不给订阅那侧显示测试按钮。

export const runtime = 'nodejs'

async function tryOnce(url: string, token: string, model: string) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 20_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      // 与自建聊天共用同一份 Anthropic-compatible 鉴权边界。
      headers: anthropicHeaders(token),
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: ac.signal,
      cache: 'no-store',
    })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    const err = e as Error
    return { status: 0, text: err.name === 'AbortError' ? '超时（20 秒没回）' : String(err.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

/** 从上游那堆 JSON 里挑出能给人看的一句。 */
function readableError(status: number, text: string): string {
  if (status === 0) return text
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const err = parsed.error
    if (err && typeof err === 'object') {
      const msg = (err as Record<string, unknown>).message
      if (msg) return `HTTP ${status}: ${String(msg).slice(0, 160)}`
    }
    if (parsed.message) return `HTTP ${status}: ${String(parsed.message).slice(0, 160)}`
  } catch {
    /* 不是 JSON 就直接截原文 */
  }
  return `HTTP ${status}: ${text.replace(/\s+/g, ' ').slice(0, 160) || '没有响应内容'}`
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const providerId = String(body.provider_id || '').trim()
  const model = String(body.model || '').trim()
  if (!model) return Response.json({ ok: false, error: '没填模型名' }, { status: 400 })

  const up = await loadUpstreamConfig()
  if (!up.ok) return Response.json({ ok: false, error: `读不到配置：${up.error}` }, { status: 502 })

  const hit = resolveProvider(up.config, providerId)
  if (!hit) return Response.json({ ok: false, error: '这个中转站还没保存过，先点保存' }, { status: 400 })
  if (!hit.authToken) return Response.json({ ok: false, error: '这个中转站没填 token' }, { status: 400 })

  const startedAt = Date.now()
  let last = { status: 0, text: '没试成' }
  for (const url of candidateAnthropicUrls(hit.baseUrl)) {
    const res = await tryOnce(url, hit.authToken, model)
    if (res.status >= 200 && res.status < 300) {
      return Response.json({ ok: true, elapsed_ms: Date.now() - startedAt, url })
    }
    last = res
    // 401 / 403 是 token 的事，换路径也一样，别白打第二次
    if (res.status === 401 || res.status === 403) break
  }

  return Response.json({
    ok: false,
    error: readableError(last.status, last.text),
    elapsed_ms: Date.now() - startedAt,
  })
}
