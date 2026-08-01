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
  afterEach(() => vi.unstubAllGlobals())

  it('parses fragmented CRLF thinking, text, usage and ignores unknown events', async () => {
    const text: string[] = []
    const thinking: string[] = []
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
      onThinking: value => thinking.push(value),
    })
    expect(thinking).toEqual(['想'])
    expect(text).toEqual(['答'])
    expect(result.assistantText).toBe('答')
    expect(result.thinkingText).toBe('想')
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
