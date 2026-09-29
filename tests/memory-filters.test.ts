import { describe, expect, it } from 'vitest'
import { getMonthChapters, getOnThisDay, getTopTags, groupByDate, groupByMonth, matchesDateFilter, matchesQuickFilter } from '../app/memory/memoryFilters'
import type { Bucket } from '../app/memory/memoryTypes'

const bucket = (id: string, changes: Partial<Bucket> = {}): Bucket => ({
  id, name: id, type: 'note', domain: [], tags: [], valence: 0.5, arousal: 0.5,
  importance: 3, resolved: false, pinned: false, created: '2026-09-29T08:00:00Z',
  last_active: '', score: 1, content_preview: '', ...changes,
})

describe('memory filters and grouping', () => {
  it('keeps quick filter boundaries, including pinned feel and resolved noise', () => {
    expect(matchesQuickFilter(bucket('feel', { pinned: true, type: 'feel' }), 'pinned')).toBe(false)
    expect(matchesQuickFilter(bucket('feel', { pinned: true, type: 'feel' }), 'feel')).toBe(true)
    expect(matchesQuickFilter(bucket('noise', { resolved: true, importance: 1 }), 'noise')).toBe(true)
    expect(matchesQuickFilter(bucket('other'), 'other')).toBe(true)
  })

  it('uses the existing created field for custom date filtering', () => {
    const item = bucket('date', { event_time: '2026-09-28T20:00:00Z' })
    expect(matchesDateFilter(item, 'custom', '2026-09-29', '2026-09-29')).toBe(true)
    expect(matchesDateFilter(item, 'custom', '2026-09-28', '2026-09-28')).toBe(false)
  })

  it('groups by event date and puts pinned entries first within a day', () => {
    const ordinary = bucket('ordinary', { event_time: '2026-09-28T18:00:00Z' })
    const pinned = bucket('pinned', { pinned: true, event_time: '2026-09-28T08:00:00Z' })
    const next = bucket('next')
    expect(groupByDate([ordinary, pinned, next]).map(group => group.date)).toEqual(['2026-09-29', '2026-09-28'])
    expect(groupByMonth([ordinary, pinned, next])[0].days[1].items.map(item => item.id)).toEqual(['pinned', 'ordinary'])
  })

  it('uses bucketDate for both month and day even when last_active differs', () => {
    const item = bucket('birthday', { event_time: '2026-09-29', last_active: '2026-09-30T04:00:00Z' })
    expect(groupByDate([item])[0].date).toBe('2026-09-29')
    expect(groupByMonth([item])[0].month).toBe('2026-09')
  })

  it('returns the most frequent tags', () => {
    expect(getTopTags([bucket('a', { tags: ['x', 'y'] }), bucket('b', { tags: ['x'] })], 1)).toEqual(['x'])
  })

  it('parses month chapters only from pinned annual relationship timelines', () => {
    const chapters = getMonthChapters([
      bucket('timeline', { pinned: true, name: '2026年关系时间线', content: '8月·夏天：雨落在窗上\n9月·日常：主动唤醒上线，开始过日子' }),
      bucket('ignored', { name: '2025年关系时间线', content: '9月·旧：不应显示' }),
    ])
    expect(chapters['2026-09']).toEqual({ name: '日常', description: '主动唤醒上线，开始过日子' })
    expect(chapters['2025-09']).toBeUndefined()
  })

  it('finds the highest importance on the same calendar day and handles missing dates', () => {
    const low = bucket('low', { event_time: '2026-08-29', importance: 3 })
    const high = bucket('high', { event_time: '2026-08-29', importance: 8 })
    expect(getOnThisDay([low, high], '2026-09-29')?.bucket.id).toBe('high')
    expect(getOnThisDay([low], '2026-03-31')).toBeNull()
  })

  it('prefers the prior year once history reaches it, then falls back to the prior month', () => {
    const lastYear = bucket('year', { event_time: '2025-09-29', importance: 2 })
    const lastMonth = bucket('month', { event_time: '2026-08-29', importance: 9 })
    expect(getOnThisDay([lastYear, lastMonth], '2026-09-29')?.bucket.id).toBe('year')
    expect(getOnThisDay([bucket('old', { event_time: '2025-01-01' }), lastMonth], '2026-09-29')?.bucket.id).toBe('month')
  })
})
