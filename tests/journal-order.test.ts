import { describe, expect, it } from 'vitest'
import { JournalEntry, journalDate, sortJournals } from '../app/journal/journalData'

const entry = (id: string, event_time: string, created: string): JournalEntry => ({ id, name: id, author: '共同', content: id, event_time, created, locked: false })

describe('journal reading order', () => {
  it('uses diary time before creation time and keeps ties deterministic for page navigation', () => {
    const items = [
      entry('b', '2026-09-30T09:00:00+08:00', '2026-10-03T10:00:00+08:00'),
      entry('c', '2026-09-29T23:00:00+08:00', '2026-09-29T23:00:00+08:00'),
      entry('a', '2026-09-30T09:00:00+08:00', '2026-09-28T12:00:00+08:00'),
    ]
    expect(sortJournals(items).map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(items.map(item => item.id)).toEqual(['b', 'c', 'a'])
  })
  it('groups late Hong Kong diary entries on their written day', () => {
    expect(journalDate(entry('late', '2026-09-30T23:45:00+08:00', '2026-10-01T12:00:00+08:00'))).toBe('2026-09-30')
  })
})
