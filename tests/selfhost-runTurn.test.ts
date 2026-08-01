import { describe, expect, it, vi } from 'vitest'
import {
  createSelfhostStream,
  type PreparedSelfhostTurn,
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
      input.onThinking?.('先想')
      input.onText?.('最终回答')
      return {
        assistantText: '最终回答', thinkingText: '先想', stopReason: 'end_turn', url: 'https://relay.example/v1/messages',
        usage: {
          input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5, context_input_tokens: 125,
        },
        process: [
          { type: 'thinking', text: '先想', id: 'thinking-0' },
          { type: 'text', text: '最终回答', id: 'text-0' },
        ],
      }
    }),
    persist: vi.fn(async () => persistResult as Awaited<ReturnType<SelfhostRuntimeDependencies['persist']>>),
  }
}

describe('runSelfhostTurn stream contract', () => {
  it('emits usage, strictly persists, then emits done', async () => {
    const deps = dependencies({
      ok: true, stored: true, turnId: 9, roundId: 3, elapsedMs: 2, error: '', httpStatus: 200,
      idempotentReplay: false, code: '', details: {},
    })
    const body = await new Response(createSelfhostStream(prepared(), undefined, deps)).text()
    expect(body.indexOf('event: usage')).toBeLessThan(body.indexOf('event: done'))
    expect(body).toContain('"round_id":3')
    expect(body).not.toContain('event: error')
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1', expectedLastRoundId: 2, personaId: 'ombre', source: 'selfhost',
      recalledBucketIds: ['new-bucket'],
    }))
    expect(deps.recall).toHaveBeenCalledWith('现在的问题', expect.objectContaining({
      excludeIds: ['old-bucket'],
    }))
    expect(deps.streamUpstream).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'user', content: '之前' },
        { role: 'assistant', content: '回答' },
        { role: 'user', content: '现在的问题' },
      ],
    }))
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
})
