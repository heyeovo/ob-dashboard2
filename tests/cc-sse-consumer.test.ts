import { describe, expect, it, vi } from 'vitest'
import { consumeSseStream, type SseHandlers } from '@/app/cc/ccSseConsumer'

function stream(events: Array<[string, Record<string, unknown>]>) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
      controller.enqueue(encoder.encode(body.slice(0, 37)))
      controller.enqueue(encoder.encode(body.slice(37)))
      controller.close()
    },
  })
}

function handlers(): SseHandlers {
  return {
    onStart: vi.fn(), onContext: vi.fn(), onInit: vi.fn(), onDelta: vi.fn(),
    onThinking: vi.fn(), onUsage: vi.fn(), onRecall: vi.fn(), onTool: vi.fn(),
    onToolResult: vi.fn(), onPermission: vi.fn(), onPermissionResolved: vi.fn(),
    onDone: vi.fn(), onAfter: vi.fn(), onError: vi.fn(),
  }
}

describe('10.3 unified cc/selfhost SSE consumer', () => {
  it('dispatches selfhost start, recall, context, init, thinking, delta, usage and done', async () => {
    const target = handlers()
    const terminal = await consumeSseStream(stream([
      ['start', { request_id: 'r1' }],
      ['recall', { ok: true }],
      ['context', { input_tokens_estimated: 100 }],
      ['init', { model: 'm1' }],
      ['thinking', { text: '想' }],
      ['delta', { text: '答' }],
      ['usage', { input_tokens: 10 }],
      ['done', { round_id: 2 }],
    ]), target)
    expect(terminal).toBe('done')
    expect(target.onStart).toHaveBeenCalledOnce()
    expect(target.onRecall).toHaveBeenCalledOnce()
    expect(target.onContext).toHaveBeenCalledOnce()
    expect(target.onInit).toHaveBeenCalledOnce()
    expect(target.onThinking).toHaveBeenCalledOnce()
    expect(target.onDelta).toHaveBeenCalledOnce()
    expect(target.onUsage).toHaveBeenCalledOnce()
    expect(target.onDone).toHaveBeenCalledWith({ round_id: 2 })
  })

  it('preserves a structured persistence error as the terminal event', async () => {
    const target = handlers()
    const terminal = await consumeSseStream(stream([
      ['error', { code: 'persistence_unknown', generated_not_saved: false }],
    ]), target)
    expect(terminal).toBe('error')
    expect(target.onError).toHaveBeenCalledWith({ code: 'persistence_unknown', generated_not_saved: false })
  })
})
