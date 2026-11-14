import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const f = vi.hoisted(() => ({ session: vi.fn(), history: vi.fn(), persona: vi.fn(), lookup: vi.fn(),
  patch: vi.fn(), persist: vi.fn(), recall: vi.fn(), rolling: vi.fn(), stream: vi.fn(), control: vi.fn() }))
vi.mock('@/app/lib/havenTurns', () => ({ getConversationSession: f.session, listAllTurns: f.history,
  getTurnByRequestId: f.lookup, patchConversationSessionState: f.patch, recordTurnStrict: f.persist }))
vi.mock('@/app/lib/havenPersonas', () => ({ getPersona: f.persona, buildPersonaAppend: () => '人设' }))
vi.mock('@/app/lib/havenRecall', () => ({ recallForPrompt: f.recall }))
vi.mock('@/app/lib/cc/windowPrompt', () => ({ loadRollingWindowAppend: f.rolling,
  composeWindowPersonaAppend: (_p: unknown, _s: unknown, _id: unknown, append: string) => `人设\n${append}` }))
vi.mock('@/app/lib/gptSubscription/transport', async importOriginal => {
  const actual = await importOriginal<typeof import('@/app/lib/gptSubscription/transport')>()
  return { ...actual, streamGpt: f.stream, controlGptRequest: f.control }
})

import { startGptTurn, getGptTurn, stopGptTurn, requestFingerprint } from '@/app/lib/gptSubscription/runner'
import { GET, POST, DELETE } from '@/app/api/cc-chat-gpt/route'
import { configureServerDrain, resetServerDrainForTests, startDrain } from '@/app/lib/serverDrain'
import { GptTransportError } from '@/app/lib/gptSubscription/transport'
import type { GptRequest } from '@/app/lib/gptSubscription/contract'

let sequence = 0
let session: Record<string, unknown>
function request(): GptRequest { return { session_id: `gpt-test-${++sequence}`, request_id: `r-${sequence}`,
  persona_id: 'ombre', text: '你好', expected_last_round_id: 0, model: 'gpt-test' } }
function http(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost/api/cc-chat-gpt', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
beforeEach(() => {
  Object.values(f).forEach(mock => mock.mockReset())
  session = { session_id: '', persona_id: 'ombre', state_version: 0, context_revision: 2,
    local_engine_preference: 'cc', rolling_context: { strategy: 'fixed_window' }, prompt_module_overrides: {},
    recall_mode: 'on', daily_review_enabled: false, daily_review_snapshot: [], handoff_snapshot: {},
    gpt_subscription_overrides: { model: 'gpt-stored' } }
  f.session.mockImplementation(async (sessionId: string) => ({ ok: true, session: { ...session, session_id: sessionId },
    bucketExclusionIds: ['excluded'], contextDays: [] }))
  f.history.mockResolvedValue({ ok: true, turns: [] })
  f.persona.mockResolvedValue({ ok: true, persona: { id: 'ombre' } })
  f.lookup.mockResolvedValue({ ok: true, found: false })
  f.control.mockResolvedValue({ ok: true })
  f.patch.mockImplementation(async (input: { sessionId: string }) => ({ ok: true, session: { ...session, session_id: input.sessionId } }))
  f.persist.mockResolvedValue({ ok: true, stored: true, turnId: 7, roundId: 1,
    userMessageId: 'u7', assistantMessageId: 'a7', idempotentReplay: false })
  f.recall.mockResolvedValue({ ok: true, additionalContext: '记忆', recalledIds: ['memory'], cardCount: 1,
    chars: 2, elapsedMs: 1, domains: [], error: '' })
  f.rolling.mockResolvedValue({ content: '钉选与回顾', history: [], pinnedBucketIds: ['pinned'] })
  f.stream.mockImplementation(async (_input, _signal, delta) => { delta('回答'); return { usage: null } })
})
afterEach(() => { resetServerDrainForTests(); vi.useRealTimers(); vi.unstubAllEnvs() })

describe('GPT runner', () => {
  it('persists source/model/fingerprint/revision and returns stable IDs only after strict commit', async () => {
    const body = request()
    const response = await POST(http(body))
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).toContain('"assistant_message_id":"a7"')
    expect(text).toContain('"outcome":"completed"')
    expect(f.persist).toHaveBeenCalledWith(expect.objectContaining({ source: 'gpt_subscription', model: 'gpt-test',
      requestId: body.request_id, expectedLastRoundId: 0, recalledBucketIds: ['memory'],
      raw: expect.objectContaining({ usage: null, rolling_context_revision: 2, gpt_request_fingerprint: requestFingerprint(body) }) }))
    expect(f.stream.mock.calls[0][0].instructions).toContain('记忆')
    expect(f.stream.mock.calls[0][0].input.at(-1).content).toContain('北京时间')
  })
  it('rejects stale history before calling the model', async () => {
    f.history.mockResolvedValue({ ok: true, turns: [{ round_id: 1 }] })
    const response = await POST(http(request()))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('conversation_conflict')
    expect(f.stream).not.toHaveBeenCalled()
  })
  it('replays saved turns without a GPT call and rejects reused IDs across engines', async () => {
    const body = request()
    f.lookup.mockResolvedValue({ ok: true, found: true, turn: { id: 3, session_id: body.session_id, persona_id: 'ombre',
      round_id: 1, source: 'gpt_subscription', model: 'gpt-test', assistant_text: '已保存', user_message_id: 'u3', assistant_message_id: 'a3',
      raw_json: JSON.stringify({ gpt_request_fingerprint: requestFingerprint(body), outcome: 'completed', usage: null }) } })
    expect(await (await POST(http(body))).text()).toContain('"idempotent_replay":true')
    expect(f.stream).not.toHaveBeenCalled()
    const other = request()
    const response = await POST(http(other))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('request_id_reused')
  })
  it('deduplicates an in-flight request and rejects another request in the same window', async () => {
    let resolve!: () => void
    f.stream.mockImplementation(async (_input, _signal, delta) => { delta('一'); await new Promise<void>(r => { resolve = r }); return { usage: null } })
    const body = request()
    const first = await POST(http(body))
    const duplicate = await POST(http(body))
    const conflict = await POST(http({ ...body, request_id: `${body.request_id}-other` }))
    expect(conflict.status).toBe(409)
    resolve()
    await Promise.all([first.text(), duplicate.text()])
    expect(f.stream).toHaveBeenCalledTimes(1)
    expect(f.persist).toHaveBeenCalledTimes(1)
  })
  it('disconnect detaches only; reconnect replays events and then saved IDs', async () => {
    let resolve!: () => void
    let transportSignal!: AbortSignal
    f.stream.mockImplementation(async (_input, signal, delta) => {
      transportSignal = signal; delta('一'); await new Promise<void>(r => { resolve = r }); delta('二'); return { usage: null }
    })
    const body = request()
    const browser = new AbortController()
    const first = await startGptTurn(body, browser.signal)
    browser.abort(); await first.body!.cancel()
    expect(transportSignal.aborted).toBe(false)
    const attached = await getGptTurn(body.session_id, body.request_id, new AbortController().signal, 2)
    resolve()
    const text = await attached.text()
    expect(text).not.toContain('event: start')
    expect(text).toContain('二')
    expect(text).toContain('"assistant_message_id":"a7"')
  })
  it('stops generation, saves partial text, and does not present it as completed', async () => {
    f.stream.mockImplementation(async (_input, signal: AbortSignal, delta) => {
      delta('部分'); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })
    const body = request()
    const response = await POST(http(body))
    expect((await DELETE(http({ session_id: body.session_id, request_id: body.request_id }, 'DELETE'))).status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"outcome":"cancelled"')
    expect(text).toContain('"interrupted":true')
    expect(f.persist.mock.calls[0][0].assistantText).toBe('部分')
    expect(f.persist.mock.calls[0][0].signal).toBeUndefined()
  })
  it('persists actionable quota failure after partial output with null usage', async () => {
    f.stream.mockImplementation(async (_input, _signal, delta) => {
      delta('部分'); throw new GptTransportError('subscription_sharing_usage_limit_exceeded', '查看额度', false, 'usage_settings')
    })
    const text = await (await POST(http(request()))).text()
    expect(text).toContain('"partial_saved":true')
    expect(text).toContain('"action":"usage_settings"')
    expect(text).toContain('"outcome":"failed"')
    expect(f.persist.mock.calls[0][0].raw.usage).toBeNull()
    expect(f.persist.mock.calls[0][0].raw.recall.additional_context).toBe('记忆')
  })
  it('persistence failure never emits done; same-request retry saves draft without regenerating', async () => {
    f.persist.mockResolvedValueOnce({ ok: false, stored: false, code: 'persistence_failed', error: '保存失败', httpStatus: 502, details: {} })
    const body = request()
    const text = await (await POST(http(body))).text()
    expect(text).toContain('"generated_not_saved":true')
    expect(text).not.toContain('event: done')
    const blocked = await POST(http({ ...body, request_id: `${body.request_id}-next` }))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error.code).toBe('persistence_pending')
    const retry = await (await POST(http(body))).text()
    expect(retry).toContain('event: done')
    expect(f.stream).toHaveBeenCalledTimes(1)
    expect(f.persist).toHaveBeenCalledTimes(2)
  })
  it('rolling context uses revision-selected history, exclusions, and omits rooms', async () => {
    session.rolling_context = { strategy: 'daily_rolling' }
    await (await POST(http(request()))).text()
    expect(f.rolling.mock.calls[0][3]).toEqual({ includeRooms: false })
    expect(f.recall.mock.calls[0][1].excludeIds).toEqual(['excluded', 'pinned'])
    expect(f.stream.mock.calls[0][0].instructions).toContain('钉选与回顾')
  })
  it('drain deadline cancels only generation and waits for the partial reply to save', async () => {
    vi.useFakeTimers(); vi.stubEnv('DRAIN_TIMEOUT_MS', '1')
    f.stream.mockImplementation(async (_input, signal: AbortSignal, delta) => {
      delta('排空前文字'); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('drain')), { once: true }))
    })
    const response = await POST(http(request()))
    const text = response.text()
    configureServerDrain({ exit: vi.fn() }); startDrain('SIGTERM')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await text).toContain('"outcome":"cancelled"')
    expect(f.persist.mock.calls[0][0].assistantText).toBe('排空前文字')
    expect(f.persist.mock.calls[0][0].signal).toBeUndefined()
  })
  it('an ambiguous save is checked by request ID before retry and never regenerates', async () => {
    f.persist.mockResolvedValueOnce({ ok: false, stored: false, code: '', error: 'timeout', httpStatus: null, details: {} })
    const body = request()
    expect(await (await POST(http(body))).text()).toContain('"persistence_unknown":true')
    const draft = f.persist.mock.calls[0][0]
    f.lookup.mockResolvedValue({ ok: true, found: true, turn: { id: 7, round_id: 1, persona_id: 'ombre',
      source: 'gpt_subscription', session_id: body.session_id, model: 'gpt-test', assistant_text: draft.assistantText,
      raw_json: JSON.stringify(draft.raw) } })
    expect(await (await POST(http(body))).text()).toContain('"idempotent_replay":true')
    expect(f.stream).toHaveBeenCalledTimes(1)
    expect(f.persist).toHaveBeenCalledTimes(1)
  })
  it('rejects durable receipt conflict and deployment drain without a model call', async () => {
    f.control.mockResolvedValue({ ok: false, code: 'request_already_admitted' })
    const response = await POST(http(request()))
    expect(response.status).toBe(409)
    expect(f.stream).not.toHaveBeenCalled()
    configureServerDrain({ exit: vi.fn() }); startDrain('SIGTERM')
    const drain = await POST(http(request()))
    expect(drain.status).toBe(503)
  })
  it('resolves recovered requests from Haven and reports remote running without starting a model', async () => {
    f.lookup.mockResolvedValue({ ok: true, found: true, turn: { session_id: 'recovered', source: 'gpt_subscription', assistant_text: '已存' } })
    const response = await GET(new NextRequest('http://localhost/api/cc-chat-gpt?session_id=recovered&request_id=recovered-r'))
    expect((await response.json()).status).toBe('saved')
    f.lookup.mockResolvedValue({ ok: true, found: false })
    f.control.mockResolvedValue({ ok: true, found: true, status: 'running' })
    const running = await GET(new NextRequest('http://localhost/api/cc-chat-gpt?session_id=remote&request_id=remote-r'))
    expect((await running.json()).retry_after_ms).toBe(5000)
    expect(f.stream).not.toHaveBeenCalled()
    expect(stopGptTurn('unrelated-cc', 'r').ok).toBe(false)
  })
})
