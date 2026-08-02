import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAnthropicSse, streamAnthropicMessages } from '@/app/lib/selfhost/anthropicMessages'

function chunked(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

describe('Anthropic-compatible SSE parser', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('parses fragmented CRLF thinking, text, usage and ignores unknown events', async () => {
    const text: string[] = []
    const thinking: string[] = []
    const thinkingStartedAt: number[] = []
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 100
      return now
    })
    const raw = [
      'event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":2,"cache_creation_input_tokens":3}}}\r\n\r\n',
      'event: future_event\r\ndata: {"type":"future_event","x":1}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"想"}}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"答"}}\r\n\r\n',
      'event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\r\n\r\n',
      'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
    ].join('')
    const result = await parseAnthropicSse(chunked([raw.slice(0, 17), raw.slice(17, 101), raw.slice(101)]), {
      onText: value => text.push(value),
      onThinking: (value, startedAt) => {
        thinking.push(value)
        thinkingStartedAt.push(startedAt)
      },
    })
    expect(thinking).toEqual(['想'])
    expect(thinkingStartedAt).toHaveLength(1)
    expect(text).toEqual(['答'])
    expect(result.assistantText).toBe('答')
    expect(result.thinkingText).toBe('想')
    expect(result.process).toEqual([
      { type: 'thinking', text: '想', id: 'thinking-0', startedAt: thinkingStartedAt[0], durationMs: 100 },
      { type: 'text', text: '答', id: 'text-0' },
    ])
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 3,
      context_input_tokens: 15,
    })
  })

  it('surfaces an upstream error event', async () => {
    const promise = parseAnthropicSse(chunked([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
    ]))
    await expect(promise).rejects.toMatchObject({ code: 'overloaded_error', message: 'busy' })
  })

  it('keeps native thinking but removes a different literal thinking block from streamed text', async () => {
    const text: string[] = []
    const thinking: string[] = []
    const result = await parseAnthropicSse(chunked([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"正式思考"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<thin"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"king>另一份思考</think"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ing>最终"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"回答"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]), {
      onText: value => text.push(value),
      onThinking: value => thinking.push(value),
    })

    expect(thinking.join('')).toBe('正式思考')
    expect(text.join('')).toBe('最终回答')
    expect(result.thinkingText).toBe('正式思考')
    expect(result.assistantText).toBe('最终回答')
    expect(result.process.map(part => ({ type: part.type, text: part.text }))).toEqual([
      { type: 'thinking', text: '正式思考' },
      { type: 'text', text: '最终回答' },
    ])
  })

  it('removes a literal think block when both tags are split across streamed chunks', async () => {
    const text: string[] = []
    const result = await parseAnthropicSse(chunked([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"开头<th"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ink>不应进入正文</th"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ink>最终"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"回答"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]), {
      onText: value => text.push(value),
    })

    expect(text.join('')).toBe('开头最终回答')
    expect(result.assistantText).toBe('开头最终回答')
    expect(result.process.map(part => ({ type: part.type, text: part.text }))).toEqual([
      { type: 'text', text: '开头最终回答' },
    ])
  })

  it('rejects a stream that ends without message_stop', async () => {
    await expect(parseAnthropicSse(chunked([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
    ]))).rejects.toMatchObject({ code: 'upstream_stream_incomplete' })
  })

  it('appends /v1/messages and does not invent a thinking switch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return new Response(chunked([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await streamAnthropicMessages({
      baseUrl: 'https://relay.example/',
      token: 'server-secret',
      model: 'claude-opus-4-6-thinking',
      system: 'persona system',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 32_000,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://relay.example/v1/messages')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      model: 'claude-opus-4-6-thinking', max_tokens: 32_000, stream: true,
      system: 'persona system', messages: [{ role: 'user', content: 'hello' }],
    })
    expect(body).not.toHaveProperty('thinking')
  })
})
