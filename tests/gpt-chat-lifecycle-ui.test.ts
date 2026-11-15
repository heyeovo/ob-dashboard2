import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGptChat } from '@/app/cc/useGptChat'
import type { CcMessage } from '@/app/cc/types'

function harness() {
  const messagesRef = { current: [] as CcMessage[] }
  const errors: string[] = []
  let chat!: ReturnType<typeof useGptChat>
  const options: Parameters<typeof useGptChat>[0] = { sessionId: 's', personaId: 'p', enabled: true, ready: true,
    model: 'chosen-model', mode: 'chat', messagesRef, currentSessionRef: { current: 's' },
    abortRef: { current: null }, lastRoundIdRef: { current: 7 },
    setMessages: apply => { messagesRef.current = typeof apply === 'function' ? apply(messagesRef.current) : apply },
    setSending: () => {}, setError: value => { if (typeof value === 'string') errors.push(value) }, setDraft: () => {},
    requestContext: () => ({ include_daily_review: false }), accepted: vi.fn(), saved: vi.fn() }
  function Mount() { chat = useGptChat(options); return null }
  renderToStaticMarkup(createElement(Mount))
  return { chat, options, errors, get messages() { return messagesRef.current } }
}
afterEach(() => vi.unstubAllGlobals())
describe('GPT browser lifecycle wiring', () => {
  it('rejects attachments, work mode and missing model before a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const h = harness()
    await h.chat.send('hello', 1)
    h.options.mode = 'work'; await h.chat.send('hello', 0)
    h.options.mode = 'chat'; h.options.model = ''; await h.chat.send('hello', 0)
    expect(fetcher).not.toHaveBeenCalled()
    expect(h.errors.join(' ')).toMatch(/附件.*工作模式.*模型/)
  })
  it('preserves the complete body and request ID on uncertain save retry', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(init.body)
      return Response.json({ error: { code: 'persistence_unknown', message: 'save unknown' } }, { status: 502 })
    }))
    const h = harness()
    await h.chat.send('original text', 0)
    const original = h.messages[1].gptRetryRequest!
    h.options.model = 'changed-model'
    h.options.lastRoundIdRef.current = 99
    await h.chat.send('different input', 0, original)
    expect(bodies[1]).toBe(bodies[0])
    expect(JSON.parse(bodies[0])).toMatchObject({ text: 'original text', expected_last_round_id: 7,
      model: 'chosen-model', include_daily_review: false, mode: 'chat' })
    expect(h.messages).toHaveLength(2)
  })
  it('network failure detaches without cancelling the server and blocks a new ID', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') }); vi.stubGlobal('fetch', fetcher)
    const h = harness()
    await h.chat.send('hello', 0)
    expect(h.messages[1]).toMatchObject({ deliveryState: 'detached', gptRetryRequest: { text: 'hello' } })
    await h.chat.send('another generation', 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls.some(call => (call as unknown[])[1] && ((call as unknown[])[1] as RequestInit).method === 'DELETE')).toBe(false)
  })
  it('reloaded requests are checked with GET only, never reconstructed for POST', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const fetcher = vi.fn(async () => Response.json({ ok: true, status: 'finished_without_turn' }))
    vi.stubGlobal('fetch', fetcher)
    const h = harness()
    const pending: CcMessage = { id: 'a', role: 'assistant', text: 'partial', createdAt: 1,
      engine: 'gpt_subscription', requestId: 'old', deliveryState: 'persistence_unknown' }
    h.options.messagesRef.current = [pending]
    await h.chat.recover(pending)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toBeDefined()
    expect(h.messages[0].gptRetryRequest).toBeUndefined()
    expect(h.messages[0].deliveryState).toBe('persistence_unknown')
  })
  it('stops only the exact active request and waits for its saved cancelled outcome', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url, init })
      return init.method === 'DELETE' ? Response.json({ ok: true, cancel_requested: true })
        : new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }))
    const h = harness()
    const sending = h.chat.send('hello', 0)
    await Promise.resolve(); await Promise.resolve()
    const request = h.messages[1].gptRetryRequest!
    await h.chat.stop()
    expect(calls[1]).toMatchObject({ url: '/api/cc-chat-gpt', init: { method: 'DELETE' } })
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ session_id: 's', request_id: request.request_id })
    expect(h.messages[1].deliveryState).not.toBe('saved')
    controller.enqueue(new TextEncoder().encode(`id: 1\nevent: done\ndata: ${JSON.stringify({ request_id: request.request_id,
      turn_id: 8, round_id: 8, user_message_id: 'u8', assistant_message_id: 'a8', model: 'chosen-model',
      outcome: 'cancelled', interrupted: true, usage: null })}\n\n`))
    controller.close(); await sending
    expect(h.messages[1]).toMatchObject({ deliveryState: 'saved', interrupted: true, gptOutcome: 'cancelled' })
  })
  it('a failed stop does not claim cancellation', async () => {
    const h = harness()
    h.options.messagesRef.current = [{ id: 'a', role: 'assistant', text: '', createdAt: 1,
      engine: 'gpt_subscription', requestId: 'r', deliveryState: 'detached' }]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false }, { status: 409 })))
    await h.chat.stop()
    expect(h.messages[0].deliveryState).toBe('detached')
    expect(h.errors.join(' ')).toContain('未确认停止')
  })
  it('restores the full retry envelope after reload while using GET to reconcile', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'POST'
      ? Response.json({ error: { code: 'persistence_unknown', message: 'save unknown' } }, { status: 502 })
      : Response.json({ ok: true, status: 'finished_without_turn' }))
    vi.stubGlobal('fetch', fetcher)
    const first = harness(); await first.chat.send('original', 0)
    const original = first.messages[1].gptRetryRequest
    const reloaded = harness(); await reloaded.chat.recover()
    expect(reloaded.messages[1].gptRetryRequest).toEqual(original)
    expect(fetcher.mock.calls[1][1].method).toBe('GET')
    await reloaded.chat.recover()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
