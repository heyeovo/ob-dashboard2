import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORY_TOKEN_BUDGET,
  estimateTurnTokens,
  nominalContextLimit,
  resolveSelfhostSettings,
  selectHistory,
} from '@/app/lib/selfhost/contextBudget'
import type { HavenTurn } from '@/app/lib/havenTurns'

function turn(id: number, user: string, assistant: string): HavenTurn {
  return {
    id,
    session_id: 's-1',
    round_id: id,
    created_at: '',
    user_text: user,
    assistant_text: assistant,
    model: '',
    client: '',
    route: '',
    source: 'cc',
  }
}

describe('selfhost context budget', () => {
  it('applies global, persona, then session precedence', () => {
    expect(resolveSelfhostSettings({
      globalProviderId: 'global-provider',
      globalModel: 'global-model',
      personaDefaults: { provider_id: 'persona-provider', model: 'persona-model', history_token_budget: 88_000 },
      sessionOverrides: { model: 'session-model', max_history_rounds: 7 },
    })).toEqual({
      providerId: 'persona-provider',
      model: 'session-model',
      historyTokenBudget: 88_000,
      maxHistoryRounds: 7,
      replyReserveTokens: 32_000,
    })
    expect(resolveSelfhostSettings({}).historyTokenBudget).toBe(DEFAULT_HISTORY_TOKEN_BUDGET)
  })

  it('recognizes Opus 4.6 relay aliases as nominal 1M', () => {
    expect(nominalContextLimit('claude-opus-4-6-thinking')).toBe(1_000_000)
    expect(nominalContextLimit('claude-opus-4-5')).toBe(200_000)
  })

  it('keeps the newest contiguous whole rounds and reports omissions', () => {
    const turns = [turn(1, 'a'.repeat(900), 'b'.repeat(900)), turn(2, 'c'.repeat(90), 'd'.repeat(90))]
    const result = selectHistory({
      turns,
      system: 'system',
      currentUserText: 'now',
      model: 'claude-opus-4-6-thinking',
      historyTokenBudget: 100,
      maxHistoryRounds: 0,
      replyReserveTokens: 32_000,
    })
    expect(result.error).toBe('')
    expect(result.selected.map(item => item.id)).toEqual([2])
    expect(result.stats.included_history_rounds).toBe(1)
    expect(result.stats.omitted_history_rounds).toBe(1)
    expect(result.stats.truncated).toBe(true)
  })

  it('fails before upstream when fixed content exceeds the nominal limit', () => {
    const result = selectHistory({
      turns: [],
      system: '中'.repeat(700_000),
      currentUserText: 'now',
      model: 'claude-opus-4-5',
      historyTokenBudget: 0,
      maxHistoryRounds: 0,
      replyReserveTokens: 32_000,
    })
    expect(result.error).toContain('未向上游发送')
  })

  it('counts MCP tool definitions as fixed context', () => {
    const withoutTools = selectHistory({
      turns: [], system: 'system', currentUserText: 'now', model: 'claude-opus-4-5',
      historyTokenBudget: 0, maxHistoryRounds: 0, replyReserveTokens: 32_000,
    })
    const withTools = selectHistory({
      turns: [], system: 'system', currentUserText: 'now', toolDefinitionsText: 'x'.repeat(3_000),
      model: 'claude-opus-4-5', historyTokenBudget: 0, maxHistoryRounds: 0, replyReserveTokens: 32_000,
    })
    expect(withTools.stats.fixed_tokens_estimated).toBeGreaterThan(withoutTools.stats.fixed_tokens_estimated)
  })

  it('counts current and historical file text in the context budget', () => {
    const plain = turn(1, 'hello', 'reply')
    const withFile: HavenTurn = {
      ...plain,
      attachments: [{
        id: 'file-1', session_id: 's-1', turn_id: 1, round_id: 1,
        filename: 'notes.md', kind: 'file', mime_type: 'text/markdown', byte_size: 100,
        sha256: 'abc', text_chars: 30_000, text_truncated: false,
        created_at: '', cleared: false,
      }],
    }
    expect(estimateTurnTokens(withFile)).toBeGreaterThan(estimateTurnTokens(plain) + 9_000)

    const withoutFile = selectHistory({
      turns: [], system: 'system', currentUserText: 'now', model: 'claude-opus-4-5',
      historyTokenBudget: 0, maxHistoryRounds: 0, replyReserveTokens: 32_000,
    })
    const withCurrentFile = selectHistory({
      turns: [], system: 'system', currentUserText: 'now', currentDocumentText: '文'.repeat(30_000),
      model: 'claude-opus-4-5', historyTokenBudget: 0, maxHistoryRounds: 0, replyReserveTokens: 32_000,
    })
    expect(withCurrentFile.stats.fixed_tokens_estimated).toBeGreaterThan(withoutFile.stats.fixed_tokens_estimated)
  })
})
