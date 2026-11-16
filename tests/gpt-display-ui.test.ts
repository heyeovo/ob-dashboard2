import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CcMessageRow from '@/app/cc/CcMessageRow'
import CcGptUsage, { GptUsageTokenButton } from '@/app/cc/CcGptUsage'
import { gptTotalTokens, normalizeGptContext } from '@/app/cc/gptPresentation'
import { getCcChatMetrics } from '@/app/cc/CcChatMetrics'
import CcTopbar from '@/app/cc/CcTopbar'
import type { CcChatScope } from '@/app/cc/CcChatScope'
import type { CcMessage, GptUsage } from '@/app/cc/types'

const preferences = vi.hoisted(() => ({ showRuntimeInfo: false, showTokenInfo: true }))
vi.mock('@/app/lib/chatDisplayPreferences', () => ({ useChatDisplayPreferences: () => preferences }))
const usage: GptUsage = { input_tokens: 100, output_tokens: 20, total_tokens: 120,
  cached_tokens: 80, reasoning_tokens: 10 }
function render(overrides: Partial<CcMessage> = {}) {
  return renderToStaticMarkup(createElement(CcMessageRow, { message: { id: 'gpt', role: 'assistant',
    text: 'reply', createdAt: 1, engine: 'gpt_subscription', model: 'actual-gpt-model', gptUsage: usage,
    gptContext: { inputTokensEstimated: 1000, applicationInputBudget: 120000, modelContextLimit: null,
      includedHistoryRounds: 2, omittedHistoryRounds: 0 }, ...overrides },
    isCurrentTurn: true, onCopy: () => {}, onRetryPersistence: () => {} }))
}
describe('GPT reuses message display positions and preferences', () => {
  it('puts the total in the original operation row and removes extra source and usage lines', () => {
    preferences.showRuntimeInfo = false; preferences.showTokenInfo = true
    const html = render()
    expect(html).toMatch(/cc-row-actions[\s\S]*120 tok/)
    expect(html).not.toContain('来源：')
    expect(html).not.toContain('GPT 用量：')
    expect(html).not.toContain('actual-gpt-model')
    expect(html).not.toContain('上下文详情')
  })
  it('uses the runtime switch for model and context entry, independently of token visibility', () => {
    preferences.showRuntimeInfo = true; preferences.showTokenInfo = false
    const html = render()
    expect(html).toContain('actual-gpt-model')
    expect(html).toContain('上下文详情')
    expect(html).not.toContain('120 tok')
    preferences.showRuntimeInfo = false; preferences.showTokenInfo = true
  })
  it('keeps failure and persistence recovery visible with both display switches off', () => {
    preferences.showRuntimeInfo = false; preferences.showTokenInfo = false
    const html = render({ gptOutcome: 'failed', deliveryState: 'persistence_unknown', deliveryNote: '保存尚未确认' })
    expect(html).toContain('保存尚未确认')
    expect(html).toContain('核对保存状态')
    expect(html).not.toContain('120 tok')
    preferences.showTokenInfo = true
  })
  it('keeps real zero, missing tokens and unknown duration distinct', () => {
    const zero = { ...usage, input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    expect(render({ gptUsage: zero })).toContain('0 tok')
    expect(render({ gptUsage: null })).toContain('Token 未取得')
    const details = renderToStaticMarkup(createElement(CcGptUsage, { usage, elapsedMs: null }))
    expect(details).toContain('缓存（输入内）')
    expect(details).toContain('推理（输出内）')
    expect(details).toContain('未取得')
    expect(renderToStaticMarkup(createElement(CcGptUsage, { usage, elapsedMs: 1250 }))).toContain('1.3s')
  })
  it('sums only input and output when total is missing, never cached or reasoning subsets', () => {
    expect(gptTotalTokens({ ...usage, total_tokens: null })).toBe(120)
    expect(gptTotalTokens({ ...usage, total_tokens: null, input_tokens: null })).toBeNull()
    expect(renderToStaticMarkup(createElement(GptUsageTokenButton, {
      usage: { ...usage, total_tokens: null }, onClick: () => {},
    }))).toContain('120 tok')
    expect(normalizeGptContext({ input_tokens_estimated: -1, application_input_budget: '120000' })).toBeNull()
  })
  it('reads only the latest GPT estimate and never borrows Claude context or application budget as a model cap', () => {
    const chat = { effectiveEngine: 'gpt_subscription', gptModel: 'selected-model', upstream: { subscriptionModels: [] },
      pick: { kind: 'subscription', model: '' }, stats: { contextTokens: 99999, contextMaxTokens: 200000,
        contextSnapshot: null, compactionCount: 0 }, promptModuleOverrides: {}, messages: [
        { id: 'cc', role: 'assistant', text: '', laneId: 'subscription', context: { inputTokensEstimated: 99999 } },
        { id: 'gpt', role: 'assistant', text: '', engine: 'gpt_subscription', model: 'actual-model',
          gptContext: { inputTokensEstimated: 1000, applicationInputBudget: 120000, modelContextLimit: null } },
      ] } as unknown as Parameters<typeof getCcChatMetrics>[0]
    const people = { active: { promptModules: [], basePrompt: '', purpose: '', memoryEntries: [] } } as Parameters<typeof getCcChatMetrics>[1]
    const result = getCcChatMetrics(chat, people, 0)
    expect(result).toMatchObject({ shownModel: 'actual-model', ctxTokens: 1000, ctxMax: 0, contextSnapshot: null })
    chat.messages.push({ id: 'new', role: 'assistant', text: '', createdAt: 1, engine: 'gpt_subscription' })
    expect(getCcChatMetrics(chat, people, 0)).toMatchObject({ ctxTokens: 0, ctxMax: 0 })
  })
  it('uses the runtime switch in the existing topbar and preserves a genuine zero estimate', () => {
    const scope = { chat: { effectiveEngine: 'gpt_subscription', gptModel: 'test-gpt-model',
      pick: { kind: 'subscription' }, upstream: { subscriptionModels: [] }, stats: { turnCount: 1 } },
      people: { active: { name: 'Name', initial: 'N' } }, selectedMessageIds: new Set(),
      metrics: { shownModel: 'test-gpt-model', shownProvider: 'GPT 订阅', ctxTokens: 0, ctxMax: 0,
        gptContext: { inputTokensEstimated: 0 } } } as unknown as CcChatScope
    preferences.showRuntimeInfo = false
    const hidden = renderToStaticMarkup(createElement(CcTopbar, { scope }))
    expect(hidden).not.toContain('test-gpt-model')
    expect(hidden).not.toContain('Context')
    expect(hidden).toContain('额度未取得')
    preferences.showRuntimeInfo = true
    const visible = renderToStaticMarkup(createElement(CcTopbar, { scope }))
    expect(visible).toContain('test-gpt-model')
    expect(visible).toContain('Context 估算 0')
    expect(visible).not.toContain('%')
    preferences.showRuntimeInfo = false
  })
  it('preserves the original CC token total including separate cache buckets', () => {
    preferences.showTokenInfo = true
    const html = render({ engine: 'cc', usage: { inputTokens: 100, outputTokens: 20,
      cacheReadTokens: 80, cacheWriteTokens: 10, cacheWrite1hTokens: 0, cacheWrite5mTokens: 0,
      durationMs: 1000, tokensPerSec: 20 } })
    expect(html).toContain('210 tok')
    expect(html).not.toContain('120 tok')
  })
})
