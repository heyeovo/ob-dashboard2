import 'server-only'
import { getHavenGatewayConnection, joinHavenUrl } from '../havenConfig'
import { takeSseFrame } from '../cc/sseEvents'
import type { GptUsage } from './contract'

export class GptTransportError extends Error {
  constructor(public code: string, message: string, public retryable = false,
    public action?: string, public status?: number, public officialRequestId?: string) { super(message); this.name = 'GptTransportError' }
}
export type GptInput = { role: 'user' | 'assistant' | 'developer'; content: string }
export type GptResult = { usage: GptUsage | null; responseId?: string; requestId?: string }

function failure(value: unknown, status?: number) {
  const b = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const e = b.error && typeof b.error === 'object' ? b.error as Record<string, unknown> : b
  return new GptTransportError(typeof e.code === 'string' ? e.code : 'gateway_failed',
    typeof e.message === 'string' ? e.message : 'GPT 服务暂时不可用，请稍后重试',
    e.retryable === true, typeof e.action === 'string' ? e.action : undefined,
    status ?? (typeof e.status === 'number' ? e.status : undefined),
    typeof e.requestId === 'string' ? e.requestId : undefined)
}

export async function gptGateway(operation: string, body?: unknown, signal?: AbortSignal) {
  const connection = getHavenGatewayConnection()
  return fetch(joinHavenUrl(connection.baseUrl, `/gateway/api/gpt-subscription/${operation}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
    signal: signal || AbortSignal.timeout(15_000),
  })
}

export async function controlGptRequest(body: Record<string, unknown>) {
  const response = await gptGateway('chat-requests', body)
  const result = await response.json() as { ok: boolean; code?: string; status?: string; found?: boolean }
  if (!response.ok && response.status !== 409) throw failure(result, response.status)
  return result
}

export function actualUsage(value: unknown): GptUsage | null {
  if (!value || typeof value !== 'object') return null
  const b = value as Record<string, unknown>
  const result = {} as GptUsage
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'cached_tokens', 'reasoning_tokens'] as const) {
    const number = b[key]
    result[key] = typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null
  }
  return Object.values(result).some(value => value !== null) ? result : null
}

export async function streamGpt(input: {
  request_id: string; model: string; instructions: string; input: GptInput[]
}, signal: AbortSignal, onDelta: (text: string) => void): Promise<GptResult> {
  const encoded = JSON.stringify(input)
  if (new TextEncoder().encode(encoded).length >= 4 * 1024 * 1024 || input.input.length > 2000) {
    throw new GptTransportError('context_too_large', '上下文过长，请减少带入的日期或记忆')
  }
  const response = await gptGateway('responses', input, signal)
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null)
    throw failure(value, response.status)
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new GptTransportError('invalid_stream', 'GPT 返回了无效的流式响应', true)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outputBytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      if (buffer.length > 2 * 1024 * 1024) throw new GptTransportError('invalid_stream', 'GPT 流式事件过长')
      while (true) {
        const parsed = takeSseFrame(buffer)
        if (parsed.rest === buffer) break
        buffer = parsed.rest
        if (!parsed.frame) continue
        const { event, data } = parsed.frame
        if (event === 'message' && Object.keys(data).length === 0) continue
        if (data.request_id !== input.request_id) throw new GptTransportError('request_mismatch', 'GPT 响应标识不匹配')
        if (event === 'delta' && typeof data.text === 'string') {
          outputBytes += new TextEncoder().encode(data.text).length
          if (outputBytes > 1024 * 1024) throw new GptTransportError('output_too_large', '回复过长，已停止并保留已有内容')
          onDelta(data.text)
        } else if (event === 'completed') {
          return { usage: actualUsage(data.usage),
            responseId: typeof data.responseId === 'string' ? data.responseId : undefined,
            requestId: typeof data.requestId === 'string' ? data.requestId : undefined }
        } else if (event === 'error') throw failure(data)
      }
      if (done) throw new GptTransportError('stream_interrupted', 'GPT 回复中断，已有文字会保留', true)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
