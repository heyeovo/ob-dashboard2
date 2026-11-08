import { describe, expect, it } from 'vitest'
import { WORD_BASELINE, formatWan, summarizeWordStats } from '../app/lib/wordStats'

describe('word stats', () => {
  it('adds the pre-move baseline and splits by speaker, mode, month and today', () => {
    const summary = summarizeWordStats([
      { day: '2026-07-12', mode: 'chat', turn_count: 3, user_chars: 100, assistant_chars: 300 },
      { day: '2026-10-18', mode: 'chat', turn_count: 2, user_chars: 10, assistant_chars: 20 },
      { day: '2026-10-18', mode: 'work', turn_count: 1, user_chars: 5, assistant_chars: 500 },
    ], '2026-10-18')
    expect(summary.stored).toBe(935)
    expect(summary.total).toBe(WORD_BASELINE.chars + 935)
    expect(summary).toMatchObject({ user: 115, assistant: 820, chat: 430, work: 505, today: 535, firstDay: '2026-07-12' })
    expect(summary.months).toEqual([{ month: '2026-07', chars: 400 }, { month: '2026-10', chars: 535 }])
  })

  it('formats wan with one decimal only below a million', () => {
    expect(formatWan(9_999)).toBe('9,999')
    expect(formatWan(123_456)).toBe('12.3 万')
    expect(formatWan(2_209_058)).toBe('220 万')
  })
})
