import { describe, expect, it } from 'vitest'
import {
  deliveryFromError,
  effectiveEngine,
  normalizeProviderUsage,
  normalizeTurnContext,
  providerSelectionLocked,
  requiresImportedSessionHandoff,
} from '@/app/cc/engineRouting'

describe('10.3 engine routing and strict delivery states', () => {
  it('keeps the local preference separate from Vercel effective engine', () => {
    expect(effectiveEngine(false, 'cc')).toBe('cc')
    expect(effectiveEngine(false, 'selfhost')).toBe('selfhost')
    expect(effectiveEngine(true, 'cc')).toBe('selfhost')
  })

  it('lets selfhost continue imported Polaris history while cc requires a handoff', () => {
    expect(requiresImportedSessionHandoff('polaris', 'cc')).toBe(true)
    expect(requiresImportedSessionHandoff('gateway', 'cc')).toBe(true)
    expect(requiresImportedSessionHandoff('polaris', 'selfhost')).toBe(false)
    expect(requiresImportedSessionHandoff('cc', 'cc')).toBe(false)
    expect(requiresImportedSessionHandoff('', 'cc')).toBe(false)
  })

  it('locks a started cc provider but keeps selfhost provider switchable', () => {
    expect(providerSelectionLocked('cc', true)).toBe(true)
    expect(providerSelectionLocked('cc', false)).toBe(false)
    expect(providerSelectionLocked('selfhost', true)).toBe(false)
  })

  it('normalizes provider usage and context estimates without mixing them', () => {
    expect(normalizeProviderUsage({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 10,
    })).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 10 })
    expect(normalizeTurnContext({
      model_context_limit: 200_000,
      reply_reserve_tokens: 32_000,
      input_tokens_estimated: 1234,
      included_history_rounds: 4,
      omitted_history_rounds: 2,
    })).toMatchObject({
      modelContextLimit: 200_000,
      replyReserveTokens: 32_000,
      inputTokensEstimated: 1234,
      includedHistoryRounds: 4,
      omittedHistoryRounds: 2,
    })
  })

  it('distinguishes persistence unknown, generated-not-saved and cross-device conflicts', () => {
    expect(deliveryFromError({ code: 'persistence_unknown', persistence_unknown: true }).state)
      .toBe('persistence_unknown')
    expect(deliveryFromError({ code: 'persistence_failed', generated_not_saved: true }).state)
      .toBe('not_saved')
    expect(deliveryFromError({ code: 'conversation_conflict', http_status: 409, generated_not_saved: true }).state)
      .toBe('conflict')
  })
})
