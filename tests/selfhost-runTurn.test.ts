import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSelfhostStream,
  type PreparedSelfhostTurn,
  type ReplaySelfhostTurn,
  type SelfhostRuntimeDependencies,
} from '@/app/lib/selfhost/runSelfhostTurn'

function prepared(): PreparedSelfhostTurn {
  return {
    kind: 'ready',
    request: {
      sessionId: 'session-1',
      requestId: 'request-1',
      expectedLastRoundId: 2,
      personaId: 'ombre',
      text: '现在的问题',
    },
    persona: {
      id: 'ombre', name: 'Ombre', initial: 'O', tint: '', user_name: '', purpose: '', description: '', prompt: '',
      memory_entries: [], dirs: [], write_dirs: [], recall_on: true, semantic_on: true, engine: 'selfhost', sort_order: 0,
      created_at: '', updated_at: '',
    },
    session: null,
    history: [{
      id: 2, session_id: 'session-1', round_id: 2, created_at: '', user_text: '之前', assistant_text: '回答',
      model: '', client: '', route: '', source: 'cc',
      raw_json: JSON.stringify({
        recall: { additional_context: '上一轮召回背景', recalled_ids: ['old-bucket'] },
      }),
    }],
    bucketExclusionIds: ['old-bucket'],
    settings: {
      providerId: 'provider-1', model: 'claude-opus-4-6-thinking', historyTokenBudget: 150_000,
      maxHistoryRounds: 0, replyReserveTokens: 32_000,
    },
    provider: { providerId: 'provider-1', baseUrl: 'https://relay.example', authToken: 'secret', label: 'Relay' },
  }
}

function dependencies(persistResult: Record<string, unknown>): SelfhostRuntimeDependencies {
  return {
    recall: vi.fn(async () => ({
      ok: true, additionalContext: '召回背景', cardCount: 1, chars: 4, elapsedMs: 1,
      recalledIds: ['new-bucket'], domains: [], error: '', httpStatus: 200,
    })),
    streamUpstream: vi.fn(async input => {
      input.onThinking?.('先想', 12_000)
      input.onText?.('最终回答')
      return {
        assistantText: '最终回答', thinkingText: '先想', stopReason: 'end_turn', url: 'https://relay.example/v1/messages',
        usage: {
          input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5, context_input_tokens: 125,
        },
        process: [
          { type: 'thinking', text: '先想', id: 'thinking-0', startedAt: 12_000, durationMs: 2_500 },
          { type: 'text', text: '最终回答', id: 'text-0' },
        ],
      }
    }),
    persist: vi.fn(async () => persistResult as Awaited<ReturnType<SelfhostRuntimeDependencies['persist']>>),
  }
}

describe('runSelfhostTurn stream contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it('emits usage, strictly persists, then emits done', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1_000
      return now
    })
    const deps = dependencies({
      ok: true, stored: true, turnId: 9, roundId: 3, elapsedMs: 2, error: '', httpStatus: 200,
      idempotentReplay: false, code: '', details: {},
    })
    const body = await new Response(createSelfhostStream(prepared(), undefined, deps)).text()
    expect(body.indexOf('event: usage')).toBeLessThan(body.indexOf('event: done'))
    expect(body).toContain('"startedAt":12000')
    expect(body).toContain('"round_id":3')
    expect(body).toContain('"injected":true')
    expect(body).toContain('"text":"召回背景"')
    expect(body).toContain('"durationMs":1000')
    expect(body).toContain('"tokensPerSec":10')
    expect(body).not.toContain('event: error')
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1', expectedLastRoundId: 2, personaId: 'ombre', source: 'selfhost',
      userText: '现在的问题',
      recalledBucketIds: ['new-bucket'],
    }))
    expect(vi.mocked(deps.persist).mock.calls[0][0].raw).toMatchObject({
      recall: {
        injected: true,
        modules: [{ key: 'memory_card', text: '召回背景' }],
        additional_context: '召回背景',
      },
      usage: {
        durationMs: 1_000,
        tokensPerSec: 10,
      },
    })
    expect(deps.recall).toHaveBeenCalledWith('现在的问题', expect.objectContaining({
      excludeIds: ['old-bucket'],
    }))
    expect(deps.streamUpstream).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'user', content: expect.stringContaining('上一轮召回背景\n</haven_recall_reference>\n\n之前') },
        { role: 'assistant', content: '回答' },
        {
          role: 'user',
          content: expect.stringMatching(
            /^现在的问题\n\n<运行时信息>\n当前北京时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\+08:00（Asia\/Shanghai）。这是系统提供的隐藏时间，不是用户消息。\n<\/运行时信息>$/,
          ),
        },
      ],
    }))
  })

  it('restores persisted thinking duration during idempotent replay', async () => {
    const ready = prepared()
    const replay: ReplaySelfhostTurn = {
      kind: 'replay',
      request: ready.request,
      turn: {
        ...ready.history[0],
        raw_json: JSON.stringify({
          process: [
            { type: 'thinking', text: '先想', id: 'thinking-0', startedAt: 12_000, durationMs: 2_500 },
            { type: 'text', text: '最终回答', id: 'text-0' },
          ],
        }),
      },
    }
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const body = await new Response(createSelfhostStream(replay)).text()
    expect(body).toContain('"startedAt":7500')
    expect(body).toContain('"idempotent_replay":true')
  })

  it('does not emit done when Haven rejects a cross-device race after generation', async () => {
    const deps = dependencies({
      ok: false, stored: false, turnId: 0, roundId: 0, elapsedMs: 2,
      error: '另一端产生了新消息，请刷新后重试', httpStatus: 409, idempotentReplay: false,
      code: 'conversation_conflict', details: { expected_last_round_id: 2, actual_last_round_id: 3 },
    })
    const body = await new Response(createSelfhostStream(prepared(), undefined, deps)).text()
    expect(body).toContain('event: delta')
    expect(body).toContain('event: error')
    expect(body).toContain('"code":"conversation_conflict"')
    expect(body).toContain('"generated_not_saved":true')
    expect(body).not.toContain('event: done')
  })

  it('marks a network-timeout persistence result as unknown instead of claiming not saved', async () => {
    const deps = dependencies({
      ok: false, stored: false, turnId: 0, roundId: 0, elapsedMs: 15_000,
      error: '对话存储超时/被取消', httpStatus: null, idempotentReplay: false, code: '', details: {},
    })
    const body = await new Response(createSelfhostStream(prepared(), undefined, deps)).text()
    expect(body).toContain('"code":"persistence_unknown"')
    expect(body).toContain('"persistence_unknown":true')
    expect(body).toContain('"generated_not_saved":false')
    expect(body).not.toContain('event: done')
  })

  it('aborts the upstream and skips persistence when the browser cancels the response stream', async () => {
    const deps = dependencies({
      ok: true, stored: true, turnId: 9, roundId: 3, elapsedMs: 2, error: '', httpStatus: 200,
      idempotentReplay: false, code: '', details: {},
    })
    let markStarted!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    let markAborted!: () => void
    const aborted = new Promise<void>(resolve => { markAborted = resolve })
    vi.mocked(deps.streamUpstream).mockImplementation(async input => {
      markStarted()
      return await new Promise((_, reject) => {
        input.signal?.addEventListener('abort', () => {
          markAborted()
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })

    const reader = createSelfhostStream(prepared(), undefined, deps).getReader()
    await started
    await reader.cancel()
    await aborted
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(deps.persist).not.toHaveBeenCalled()
  })
})
