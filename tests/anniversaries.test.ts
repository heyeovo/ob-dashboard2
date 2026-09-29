import { describe, expect, it } from 'vitest'
import { daysTogether, upcomingAnniversaries } from '../app/lib/anniversaries'

describe('anniversaries', () => {
  it('counts the first day and the September milestone', () => {
    expect(daysTogether('2026-04-03')).toBe(1)
    expect(daysTogether('2026-09-29')).toBe(180)
    const events = upcomingAnniversaries('2026-09-29')
    expect(events[0]).toEqual({ date: '2026-10-03', name: '半年', daysAway: 4 })
    expect(events[1]).toEqual({ date: '2026-10-19', name: '第 200 天', daysAway: 20 })
  })

  it('merges coincident anniversary rules and shows today', () => {
    const events = upcomingAnniversaries('2027-04-03')
    expect(events[0]).toEqual({ date: '2027-04-03', name: '一周年 · 言之生日', daysAway: 0 })
    expect(upcomingAnniversaries('2027-04-03', 20).find(item => item.date === '2027-10-03')?.name).toBe('一年半')
    expect(upcomingAnniversaries('2028-04-01')[0].name).toBe('两周年 · 言之生日')
  })
})
