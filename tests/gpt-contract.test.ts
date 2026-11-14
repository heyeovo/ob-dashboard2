import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseGptRequest } from '@/app/lib/gptSubscription/contract'
import { actualUsage, GptTransportError, streamGpt } from '@/app/lib/gptSubscription/transport'
import { buildGptContext } from '@/app/lib/gptSubscription/context'
import type { HavenConversationSession, HavenTurn } from '@/app/lib/havenTurns'
import type { HavenPersona } from '@/app/lib/havenPersonas'

const request = { session_id: 's', persona_id: 'ombre', request_id: 'r', text: '你好', expected_last_round_id: 0 }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('GPT public contract', () => {
  it('accepts text and rejects work/tools/attachments and coerced strict fields', () => {
    expect(parseGptRequest(request).request_id).toBe('r')
    for (const patch of [{ mode: 'work' }, { tools: [] }, { attachment_ids: ['a'] }, { recall: 'false' },
      { expected_last_round_id: '0' }, { request_id: 'bad.id' }, { model: '' }]) {
      expect(() => parseGptRequest({ ...request, ...patch })).toThrow()
    }
    expect(parseGptRequest({ ...request, attachment_ids: [] }).text).toBe('你好')
  })
  it('keeps unavailable actual usage null and preserves real zero', () => {
    expect(actualUsage(null)).toBeNull()
    expect(actualUsage({ input_tokens: '100' })).toBeNull()
    expect(actualUsage({ input_tokens: 0, output_tokens: 4 })).toEqual({ input_tokens: 0, output_tokens: 4,
      total_tokens: null, cached_tokens: null, reasoning_tokens: null })
  })
})

describe('GPT stream transport', () => {
  const input = { request_id: 'r', model: 'gpt-test', instructions: '人设', input: [{ role: 'user' as const, content: '你好' }] }
  function mockStream(events: string, split = false) {
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'synthetic-gateway-token')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.test')
    const encoded = new TextEncoder().encode(events)
    const response = new Response(new ReadableStream({ start(controller) {
      if (split) for (const byte of encoded) controller.enqueue(new Uint8Array([byte]))
      else controller.enqueue(encoded)
      controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
    const fetcher = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetcher)
    return fetcher
  }
  it('decodes split UTF8/CRLF, ignores heartbeat and accepts only completed with actual usage', async () => {
    const fetcher = mockStream(': ping\r\n\r\nevent: delta\r\ndata: {"request_id":"r","text":"你好"}\r\n\r\n'
      + 'event: completed\r\ndata: {"request_id":"r","usage":{"input_tokens":12,"output_tokens":2}}\r\n\r\n', true)
    const delta = vi.fn()
    const result = await streamGpt(input, new AbortController().signal, delta)
    expect(delta).toHaveBeenCalledWith('你好')
    expect(result.usage?.input_tokens).toBe(12)
    expect(fetcher.mock.calls[0][0]).toBe('https://haven.test/gateway/api/gpt-subscription/responses')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input)
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-gateway-token')
  })
  it('does not turn EOF or a mismatched response into success', async () => {
    mockStream('event: delta\ndata: {"request_id":"r","text":"partial"}\n\n')
    const delta = vi.fn()
    await expect(streamGpt(input, new AbortController().signal, delta)).rejects.toMatchObject({ code: 'stream_interrupted' })
    expect(delta).toHaveBeenCalledWith('partial')
    mockStream('event: completed\ndata: {"request_id":"other"}\n\n')
    await expect(streamGpt(input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'request_mismatch' })
  })
  it('preserves actionable subscription errors after partial output', async () => {
    mockStream('event: delta\ndata: {"request_id":"r","text":"partial"}\n\n'
      + 'event: error\ndata: {"request_id":"r","error":{"code":"subscription_sharing_usage_limit_exceeded","message":"查看额度","action":"usage_settings"}}\n\n')
    await expect(streamGpt(input, new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(GptTransportError)
  })
})

describe('GPT context projection', () => {
  const session = { session_id: 's', persona_id: 'ombre', prompt_module_overrides: {}, context_revision: 3,
    rolling_context: { strategy: 'fixed_window' }, daily_review_enabled: true,
    daily_review_snapshot: [{ review_date: '2026-11-14', content: '昨天回顾' }], handoff_snapshot: {} } as unknown as HavenConversationSession
  const persona = { base_prompt: '我是言之', purpose: '陪伴', memory_entries: ['小羊的固定事实'], prompt_modules: [] } as unknown as HavenPersona
  it('injects persona, reviews, recall, history and timestamp without native tools or thinking', () => {
    const history = [{ user_text: '先前问题', assistant_text: '先前回答', source: 'cc',
      raw_json: JSON.stringify({ thinking: '秘密过程', tools: ['不转换'], recall: { additional_context: '先前召回' } }) }] as HavenTurn[]
    const result = buildGptContext({ persona, session, history, rollingAppend: '', recall: '本轮召回', text: '新问题' })
    expect(result.instructions).toContain('我是言之')
    expect(result.instructions).toContain('昨天回顾')
    expect(result.instructions).toContain('本轮召回')
    expect(result.input.map(m => m.content).join('\n')).toContain('先前召回')
    expect(result.input.at(-1)?.content).toContain('北京时间')
    expect(JSON.stringify(result)).not.toContain('秘密过程')
    expect(JSON.stringify(result)).not.toContain('不转换')
    expect(result.context.model_context_limit).toBeNull()
    expect(result.context.context_revision).toBe(3)
  })
  it('uses rolling background instead of fixed review snapshot and rejects oversized fixed context', () => {
    const rollingSession = { ...session, rolling_context: { ...session.rolling_context, strategy: 'daily_rolling' as const } }
    const result = buildGptContext({ persona, session: rollingSession, history: [], rollingAppend: '冻结钉选和所选日期回顾', recall: '', text: 'hi' })
    expect(result.instructions).toContain('冻结钉选和所选日期回顾')
    expect(result.instructions).not.toContain('昨天回顾')
    expect(() => buildGptContext({ persona, session, history: [], rollingAppend: '', recall: '字'.repeat(200_000), text: 'hi' })).toThrow()
  })
})
