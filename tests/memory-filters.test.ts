import { describe, expect, it } from 'vitest'
import { getTopTags, groupByDate, groupByMonth, matchesDateFilter, matchesQuickFilter } from '../app/memory/memoryFilters'
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

  it('returns the most frequent tags', () => {
    expect(getTopTags([bucket('a', { tags: ['x', 'y'] }), bucket('b', { tags: ['x'] })], 1)).toEqual(['x'])
  })
})
