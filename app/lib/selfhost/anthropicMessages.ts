export type AnthropicMessage = { role: 'user' | 'assistant'; content: string }

export type AnthropicUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  context_input_tokens: number
}

export type AnthropicStreamResult = {
  assistantText: string
  thinkingText: string
  stopReason: string
  usage: AnthropicUsage
  process: Array<Record<string, unknown>>
  url: string
}

export class AnthropicStreamError extends Error {
  code: string
  httpStatus: number | null
  retryable: boolean

  constructor(message: string, options?: { code?: string; httpStatus?: number | null; retryable?: boolean }) {
    super(message)
    this.name = 'AnthropicStreamError'
    this.code = options?.code || 'upstream_error'
    this.httpStatus = options?.httpStatus ?? null
    this.retryable = options?.retryable ?? true
  }
}

export function candidateAnthropicUrls(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '')
  const urls = /\/v1$/i.test(base)
    ? [`${base}/messages`, `${base.slice(0, -3)}/v1/messages`]
    : [`${base}/v1/messages`, `${base}/messages`]
  return [...new Set(urls)]
}

export function anthropicHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': token,
    Authorization: `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
  }
}

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  const error = payload.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (message) return String(message)
  }
  return String(payload.message || fallback)
}

type ParsedSse = { event: string; data: Record<string, unknown> }

function parseSseFrame(raw: string): ParsedSse | null {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  try {
    const parsed = JSON.parse(data.join('\n'))
    return parsed && typeof parsed === 'object'
      ? { event, data: parsed as Record<string, unknown> }
      : { event, data: {} }
  } catch {
    throw new AnthropicStreamError('上游返回了无法解析的 SSE JSON', { code: 'invalid_upstream_sse' })
  }
}

/** 按 SSE 空行切帧；兼容任意 chunk 边界、CRLF、多行 data 和未知事件。 */
export async function parseAnthropicSse(
  body: ReadableStream<Uint8Array>,
  callbacks?: {
    onText?: (text: string) => void
    onThinking?: (text: string) => void
  },
): Promise<Omit<AnthropicStreamResult, 'url'>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assistantText = ''
  let thinkingText = ''
  let stopReason = ''
  let sawMessageStop = false
  const usage: AnthropicUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    context_input_tokens: 0,
  }
  const process: Array<Record<string, unknown>> = []
  let textPart = 0
  let thinkingPart = 0

  const appendProcessText = (type: 'text' | 'thinking', text: string) => {
    const last = process.at(-1)
    if (last?.type === type) {
      last.text = String(last.text || '') + text
      return
    }
    process.push({ type, text, id: type === 'text' ? `text-${textPart++}` : `thinking-${thinkingPart++}` })
  }

  const acceptUsage = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const item = value as Record<string, unknown>
    if ('input_tokens' in item) usage.input_tokens = numberValue(item.input_tokens)
    if ('output_tokens' in item) usage.output_tokens = numberValue(item.output_tokens)
    if ('cache_read_input_tokens' in item) usage.cache_read_input_tokens = numberValue(item.cache_read_input_tokens)
    if ('cache_creation_input_tokens' in item) usage.cache_creation_input_tokens = numberValue(item.cache_creation_input_tokens)
    usage.context_input_tokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  }

  const accept = (frame: ParsedSse) => {
    const payload = frame.data
    const type = String(payload.type || frame.event || '')
    if (type === 'ping' || type === 'message_start' || type === 'content_block_start' || type === 'content_block_stop') {
      if (type === 'message_start') {
        const message = payload.message
        if (message && typeof message === 'object') acceptUsage((message as Record<string, unknown>).usage)
      }
      return
    }
    if (type === 'content_block_delta') {
      const delta = payload.delta
      if (!delta || typeof delta !== 'object') return
      const item = delta as Record<string, unknown>
      const deltaType = String(item.type || '')
      if (deltaType === 'text_delta') {
        const text = String(item.text || '')
        if (!text) return
        assistantText += text
        appendProcessText('text', text)
        callbacks?.onText?.(text)
      } else if (deltaType === 'thinking_delta') {
        const text = String(item.thinking || '')
        if (!text) return
        thinkingText += text
        appendProcessText('thinking', text)
        callbacks?.onThinking?.(text)
      } else if (deltaType === 'signature_delta') {
        process.push({ type: 'thinking_signature', signature: String(item.signature || '') })
      }
      return
    }
    if (type === 'message_delta') {
      const delta = payload.delta
      if (delta && typeof delta === 'object') stopReason = String((delta as Record<string, unknown>).stop_reason || stopReason)
      acceptUsage(payload.usage)
      return
    }
    if (type === 'message_stop') {
      sawMessageStop = true
      return
    }
    if (type === 'error' || frame.event === 'error') {
      const nested = payload.error
      const code = nested && typeof nested === 'object' ? String((nested as Record<string, unknown>).type || 'upstream_error') : 'upstream_error'
      throw new AnthropicStreamError(errorMessage(payload, '上游流式生成失败'), { code })
    }
    // Anthropic 明确允许未来增加新事件；未知事件必须忽略。
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    // 保留 chunk 末尾的孤立 CR，等下一块确认它是不是 CRLF。
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?=.)/g, '\n')
    let split = buffer.indexOf('\n\n')
    while (split !== -1) {
      const raw = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      const frame = parseSseFrame(raw)
      if (frame) accept(frame)
      split = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  buffer = buffer.replace(/\r/g, '\n')
  if (buffer.trim()) {
    const frame = parseSseFrame(buffer)
    if (frame) accept(frame)
  }
  if (!sawMessageStop) {
    throw new AnthropicStreamError('上游连接在 message_stop 前结束', { code: 'upstream_stream_incomplete' })
  }
  return { assistantText, thinkingText, stopReason, usage, process }
}

export async function streamAnthropicMessages(input: {
  baseUrl: string
  token: string
  model: string
  system: string
  messages: AnthropicMessage[]
  maxTokens: number
  signal?: AbortSignal
  onText?: (text: string) => void
  onThinking?: (text: string) => void
}): Promise<AnthropicStreamResult> {
  let lastError = new AnthropicStreamError('没有可用的上游地址')
  for (const url of candidateAnthropicUrls(input.baseUrl)) {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: anthropicHeaders(input.token),
        body: JSON.stringify({
          model: input.model,
          max_tokens: Math.max(1, Math.floor(input.maxTokens)),
          stream: true,
          system: input.system,
          messages: input.messages,
        }),
        signal: input.signal,
        cache: 'no-store',
      })
    } catch (error) {
      const err = error as Error
      throw new AnthropicStreamError(err.name === 'AbortError' ? '上游请求已取消' : String(err.message || err), {
        code: err.name === 'AbortError' ? 'aborted' : 'upstream_network_error',
        retryable: err.name !== 'AbortError',
      })
    }
    if (!response.ok) {
      const raw = await response.text()
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { /* 原文兜底 */ }
      lastError = new AnthropicStreamError(errorMessage(parsed, raw.slice(0, 300) || `HTTP ${response.status}`), {
        code: String((parsed.error as Record<string, unknown> | undefined)?.type || 'upstream_http_error'),
        httpStatus: response.status,
        retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      })
      if (response.status === 401 || response.status === 403) break
      continue
    }
    if (!response.body) throw new AnthropicStreamError('上游成功响应没有正文流', { code: 'empty_upstream_stream' })
    const result = await parseAnthropicSse(response.body, { onText: input.onText, onThinking: input.onThinking })
    return { ...result, url }
  }
  throw lastError
}
