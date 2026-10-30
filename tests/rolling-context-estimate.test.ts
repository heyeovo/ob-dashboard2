import { describe, expect, it } from 'vitest'
import { currentDayMode, dayParts, formatContextTokens, sumParts } from '@/app/lib/cc/rollingContextEstimate'
import type { ConversationContextDay, RollingContextConfig } from '@/app/lib/havenTurns'
const day: ConversationContextDay = {
  day: '2026-10-29', turn_count: 10, raw_chars: 100, first_turn_id: 1, last_turn_id: 10,
  token_estimate: { conversation: 100, thinking: 200, tools: 300, attachments: 450, attachment_image_tokens: 400,
    recall: 500, timestamps: 10, message_overhead: 20, agent_wake: 30, total: 1610 },
  review: { content: 'review', chars: 6, estimated_tokens: 8, updated_at: '' },
}
const config: RollingContextConfig = { strategy: 'daily_rolling', timezone: 'Asia/Shanghai', day_start_hour: 4, day_modes: {} }
describe('rolling revision estimates', () => {
  it('keeps a full old day until explicitly saved, then prunes image and recall but retains files/thinking', () => {
    const current = dayParts(day, 'raw', { day: day.day, treatment: 'full' }, false)
    const after = dayParts(day, 'raw', null, true)
    expect(sumParts(current)).toBe(1610)
    expect(sumParts(after)).toBe(710)
    expect(after).toMatchObject({ thinking: 200, attachments: 50, recall: 0 })
  })
  it('honors legacy thinking pruning without assuming legacy images were removed', () => {
    expect(dayParts(day, 'raw', { day: day.day, treatment: 'pruned', thinkingPrunedBlockCount: 2, memoryRecallPrunedBlockCount: 1 }, false))
      .toMatchObject({ thinking: 0, attachments: 450, recall: 0 })
    expect(dayParts(day, 'raw', { day: day.day, treatment: 'pruned', imagePrunedBlockCount: 2, memoryRecallPrunedBlockCount: 1 }, false))
      .toMatchObject({ thinking: 200, attachments: 50, recall: 0 })
  })
  it('supports body recovery, review/omit, new days and older Haven responses missing image estimates', () => {
    expect(dayParts(day, 'raw', { day: day.day, treatment: 'body_restored' }, false)).toEqual({ conversation: 100, thinking: 0, tools: 0, attachments: 0, recall: 0, other: 60 })
    expect(sumParts(dayParts(day, 'review', null, false))).toBe(8)
    expect(sumParts(dayParts(day, 'omit', null, false))).toBe(0)
    expect(currentDayMode('2026-10-30', config)).toBe('raw')
    expect(currentDayMode('2026-10-30', { ...config, day_modes: { '2026-10-30': 'omit' } }, undefined, '2026-10-29')).toBe('raw')
    expect(dayParts({ ...day, token_estimate: { ...day.token_estimate!, attachment_image_tokens: undefined } }, 'raw', null, true).attachments).toBe(450)
    expect(currentDayMode(day.day, { ...config, day_modes: { [day.day]: 'review' } }, { day: day.day, treatment: 'removed' })).toBe('review')
  })
  it('uses one decimal k and zero consistently', () => {
    expect(formatContextTokens(0)).toBe('0')
    expect(formatContextTokens(123456)).toBe('123.5k')
  })
})
