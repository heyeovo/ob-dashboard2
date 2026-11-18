import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useGptChat } from '@/app/cc/useGptChat'
import type { CcMessage } from '@/app/cc/types'

const f = vi.hoisted(() => ({ session: vi.fn(), history: vi.fn(), persona: vi.fn(), lookup: vi.fn(),
  patch: vi.fn(), persist: vi.fn(), recall: vi.fn(), rolling: vi.fn(), stream: vi.fn(), control: vi.fn(),
  mcpConfig: vi.fn(), mcpRuntime: vi.fn() }))
vi.mock('@/app/lib/ccMcp', () => ({ loadMcpConfig: f.mcpConfig }))
vi.mock('@/app/lib/selfhost/mcp', () => ({ createSelfhostMcpRuntime: f.mcpRuntime }))
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
import { GptTransportError, type GptModelInput } from '@/app/lib/gptSubscription/transport'
import { answerPermission, workbenchState } from '@/app/lib/ccChannel'
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
  f.mcpRuntime.mockResolvedValue({ tools: [], warnings: [], close: vi.fn().mockResolvedValue(undefined) })
  f.patch.mockImplementation(async (input: { sessionId: string }) => ({ ok: true, session: { ...session, session_id: input.sessionId } }))
  f.persist.mockResolvedValue({ ok: true, stored: true, turnId: 7, roundId: 1,
    userMessageId: 'u7', assistantMessageId: 'a7', idempotentReplay: false })
  f.recall.mockResolvedValue({ ok: true, additionalContext: '记忆', recalledIds: ['memory'], cardCount: 1,
    chars: 2, elapsedMs: 1, domains: [], error: '' })
  f.rolling.mockResolvedValue({ content: '钉选与回顾', history: [], pinnedBucketIds: ['pinned'] })
  f.stream.mockImplementation(async (_input, _signal, delta) => { delta('回答'); return { usage: null } })
})
afterEach(() => { resetServerDrainForTests(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('GPT runner', () => {
  function mockTools(permission: 'allow' | 'ask' = 'allow') {
    const servers = ['alpha', 'beta'].map(name => ({
      name, label: name, enabled: true, transport: 'http', url: `https://${name}.example.test/mcp`,
      permission, saveResults: true,
    }))
    const execute = vi.fn().mockResolvedValue({ text: 'fixture-37', isError: false })
    f.mcpConfig.mockResolvedValue({ version: 1, servers })
    f.mcpRuntime.mockResolvedValue({
      tools: servers.map(server => ({ name: `mcp__${server.name}__write`, remoteName: 'write',
        serverName: server.name, description: 'Write fixture', input_schema: { type: 'object' }, saveResults: true })),
      warnings: [], configuredServer: (name: string) => servers.find(server => server.name === name),
      callTool: execute, close: vi.fn().mockResolvedValue(undefined),
    })
    f.stream.mockImplementationOnce(async (input: GptModelInput) => {
      const group = input.tools?.find(group => group.description.endsWith('beta'))!
      return { usage: null, continuation: [
        { type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'fixture' },
        { type: 'function_call', namespace: group.name, name: group.tools[0].name,
          call_id: 'call_test', arguments: '{"value":37}' },
      ] }
    })
    return { servers, execute }
  }

  it('sends an approved result to the same model turn and never repeats the write on replay', async () => {
    const { execute } = mockTools('ask')
    f.stream.mockImplementationOnce(async (input, _signal, delta) => {
      expect(input.step).toBe(1)
      expect(input.input.at(-3)).toMatchObject({ type: 'reasoning', encrypted_content: 'fixture' })
      expect(input.input.at(-1)).toEqual({ type: 'function_call_output', call_id: 'call_test', output: 'fixture-37' })
      delta('confirmed fixture-37')
      return { usage: null }
    })
    const body = request()
    const response = await POST(http(body))
    await vi.waitFor(() => expect(workbenchState(body.session_id).pending).toHaveLength(1))
    expect(execute).not.toHaveBeenCalled()
    const approval = workbenchState(body.session_id).pending[0]
    expect(approval.toolName).toBe('mcp__beta__write')
    expect(answerPermission(body.session_id, approval.id, { behavior: 'allow' })).toBe(true)
    const events = await response.text()
    expect(events).toContain('confirmed fixture-37')
    expect(events).toContain('event: tool_result')
    expect((await POST(http(body))).ok).toBe(true)
    expect(execute).toHaveBeenCalledExactlyOnceWith({ name: 'mcp__beta__write', input: { value: 37 } }, expect.any(AbortSignal))
    expect(f.stream).toHaveBeenCalledTimes(2)
  })

  it.each(['stop', 'deny', 'disable'] as const)('a pending MCP write does not run after %s', async action => {
    const { execute, servers } = mockTools('ask')
    const body = request()
    const response = await POST(http(body))
    await vi.waitFor(() => expect(workbenchState(body.session_id).pending).toHaveLength(1))
    const approval = workbenchState(body.session_id).pending[0]
    if (action === 'stop') stopGptTurn(body.session_id, body.request_id)
    else if (action === 'deny') answerPermission(body.session_id, approval.id, { behavior: 'deny', message: '拒绝执行' })
    else {
      f.mcpConfig.mockResolvedValue({ version: 1, servers: servers.map(server => ({ ...server, enabled: false })) })
      answerPermission(body.session_id, approval.id, { behavior: 'allow' })
    }
    expect(await response.text()).toContain('"status":"denied"')
    expect(execute).not.toHaveBeenCalled()
    expect(workbenchState(body.session_id).pending).toHaveLength(0)
    if (action === 'stop') expect(f.stream).toHaveBeenCalledOnce()
    else expect(f.stream.mock.calls[1][0].input.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'call_test' })
  })

  it('caps tool execution and the UTF-8 result sent to the model', async () => {
    const { execute } = mockTools()
    execute.mockResolvedValue({ text: '很长'.repeat(5000), isError: false })
    f.stream.mockReset()
      .mockImplementationOnce(async (input: GptModelInput) => {
        const group = input.tools?.[0]!
        return { usage: null, continuation: Array.from({ length: 9 }, (_, index) => ({
          type: 'function_call', namespace: group.name, name: group.tools[0].name,
          call_id: `test-${index}`, arguments: JSON.stringify({ index }),
        })) }
      })
      .mockImplementationOnce(async input => {
        const results = input.input.filter((item: { type?: string }) => item.type === 'function_call_output')
        expect(results).toHaveLength(9)
        expect(results.slice(0, 8).every((item: { output: string }) => Buffer.byteLength(item.output) <= 8192)).toBe(true)
        expect(results[8].output).toContain('已达上限')
        return { usage: null }
      })
    expect(await (await POST(http(request()))).text()).toContain('"outcome":"completed"')
    expect(execute).toHaveBeenCalledTimes(8)
  })

  it('stops an in-flight MCP call without claiming it was undone or running it again', async () => {
    const { execute } = mockTools()
    execute.mockImplementation(async (_call, signal: AbortSignal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { text: 'cancelled', isError: true }
    })
    const body = request()
    const response = await POST(http(body))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    stopGptTurn(body.session_id, body.request_id)
    expect(await response.text()).toContain('工具执行状态可能需要核对')
    expect(await (await POST(http(body))).text()).toContain('"outcome":"cancelled"')
    expect(execute).toHaveBeenCalledOnce()
    expect(f.stream).toHaveBeenCalledOnce()
  })

  it('saves body-free assembled evidence before generation and refuses generation after audit failure', async () => {
    const body = request()
    const actions: string[] = []
    f.control.mockImplementation(async value => {
      actions.push(value.action)
      if (value.action === 'prepare') {
        expect(value.snapshot.body_hash).toMatch(/^[a-f0-9]{64}$/)
        expect(JSON.stringify(value.snapshot)).not.toContain('人设')
        return { ok: false, code: 'audit_persistence_failed' }
      }
      return { ok: true }
    })
    const response = await startGptTurn(body, new AbortController().signal)
    const events = await response.text()
    expect(actions).toContain('prepare')
    expect(events).toContain('audit_persistence_failed')
    expect(f.stream).not.toHaveBeenCalled()
    expect(f.persist).not.toHaveBeenCalled()
  })

  it('persists the evidence before allowing streamGpt to run', async () => {
    let prepared = false
    f.control.mockImplementation(async value => { if (value.action === 'prepare') prepared = true; return { ok: true } })
    f.stream.mockImplementation(async () => { expect(prepared).toBe(true); return { usage: null } })
    const response = await startGptTurn(request(), new AbortController().signal)
    await response.text()
    expect(f.stream).toHaveBeenCalledOnce()
  })

  function durableAdmission() {
    const admitted = new Set<string>()
    f.control.mockImplementation(async (body: { action: string; request_id: string }) => {
      if (body.action !== 'claim') return { ok: true }
      if (admitted.has(body.request_id)) return { ok: false, code: 'request_already_admitted' }
      admitted.add(body.request_id)
      return { ok: true }
    })
  }
  it.each(['configuration', 'rolling context'])('retries the original request after failed %s preparation without consuming admission', async failure => {
    durableAdmission()
    if (failure === 'configuration') f.patch.mockResolvedValueOnce({ ok: false })
    else {
      session.rolling_context = { strategy: 'daily_rolling' }
      f.rolling.mockRejectedValueOnce(new Error('temporary context failure'))
    }
    const body = request()
    const failed = await POST(http(body))
    expect(failed.status).toBe(502)
    expect(f.stream).not.toHaveBeenCalled()
    expect(f.control).not.toHaveBeenCalled()
    const retry = await POST(http(body))
    expect(await retry.text()).toContain('event: done')
    expect(f.stream).toHaveBeenCalledTimes(1)
    expect(f.persist).toHaveBeenCalledTimes(1)
  })
  it('recovers the real browser hook from a configuration failure and unlocks subsequent sends', async () => {
    durableAdmission()
    f.patch.mockResolvedValueOnce({ ok: false })
    const cache = new Map<string, string>()
    vi.stubGlobal('window', { sessionStorage: {
      getItem: (key: string) => cache.get(key) ?? null,
      setItem: (key: string, value: string) => cache.set(key, value),
      removeItem: (key: string) => cache.delete(key),
    } })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => POST(http(JSON.parse(String(init.body))))))
    const body = request()
    const messagesRef = { current: [] as CcMessage[] }
    const options: Parameters<typeof useGptChat>[0] = {
      sessionId: body.session_id, personaId: body.persona_id, model: body.model!, mode: 'chat', enabled: true, ready: true,
      messagesRef, currentSessionRef: { current: body.session_id }, abortRef: { current: null }, lastRoundIdRef: { current: 0 },
      setMessages: apply => { messagesRef.current = typeof apply === 'function' ? apply(messagesRef.current) : apply },
      setSending: () => {}, setError: () => {}, setDraft: () => {}, requestContext: () => ({}), accepted: vi.fn(), saved: vi.fn(),
    }
    let chat!: ReturnType<typeof useGptChat>
    function Mount() { chat = useGptChat(options); return null }
    renderToStaticMarkup(createElement(Mount))
    await chat.send('first', 0)
    const original = messagesRef.current[1].gptRetryRequest!
    expect(original).toBeDefined()
    expect(cache.size).toBe(1)
    expect(f.stream).not.toHaveBeenCalled()
    await chat.send(original.text, 0, original)
    expect(messagesRef.current).toHaveLength(2)
    expect(messagesRef.current[1].deliveryState).toBe('saved')
    expect(cache.size).toBe(0)
    expect(f.stream).toHaveBeenCalledTimes(1)
    f.history.mockResolvedValue({ ok: true, turns: [{ round_id: 1, user_text: 'first', assistant_text: '回答' }] })
    await chat.send('next', 0)
    expect(f.stream).toHaveBeenCalledTimes(2)
    expect(f.persist).toHaveBeenCalledTimes(2)
  })
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
    expect(f.stream.mock.calls[0][0].instructions).not.toContain('记忆')
    expect(f.stream.mock.calls[0][0].input.at(-2).content).toContain('记忆')
    expect(f.stream.mock.calls[0][0].input.at(-1).content).toContain('北京时间')
    expect(f.persist.mock.calls[0][0].raw.gpt_runtime_context).toContain('北京时间')
    expect(f.stream.mock.calls[0][0].input.at(-1).content).toBe(`${body.text}\n\n${f.persist.mock.calls[0][0].raw.gpt_runtime_context}`)
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
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
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
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
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
    await vi.waitFor(() => expect(f.stream).toHaveBeenCalledOnce())
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
    const originalRuntime = f.persist.mock.calls[0][0].raw.gpt_runtime_context
    const blocked = await POST(http({ ...body, request_id: `${body.request_id}-next` }))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error.code).toBe('persistence_pending')
    const retry = await (await POST(http(body))).text()
    expect(retry).toContain('event: done')
    expect(f.stream).toHaveBeenCalledTimes(1)
    expect(f.persist).toHaveBeenCalledTimes(2)
    expect(f.persist.mock.calls[1][0].raw.gpt_runtime_context).toBe(originalRuntime)
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
