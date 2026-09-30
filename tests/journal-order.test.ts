import { describe, expect, it } from 'vitest'
import { JournalEntry, journalDate, sortJournals, toDateTimeLocal, toBeijingIso } from '../app/journal/journalData'

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
  it.each([
    ['2026-09-30', '2026-09-30T00:00'],
    ['2026-09-30 22:00:00', '2026-09-30T22:00'],
    ['2026-09-30T22:00:00+08:00', '2026-09-30T22:00'],
    ['2026-09-30T14:00:00Z', '2026-09-30T22:00'],
    ['2026-09-30T23:30:12.123Z', '2026-10-01T07:30'],
    ['2026-09-30T23:30:00-04:00', '2026-10-01T11:30'],
    ['2026-09-30T22:00:00+0800', '2026-09-30T22:00'],
  ])('edits %s as Beijing wall time %s', (input, expected) => {
    expect(toDateTimeLocal(input)).toBe(expected)
    expect(toDateTimeLocal(toBeijingIso(expected))).toBe(expected)
    expect(journalDate(entry('date', input, input))).toBe(expected.slice(0, 10))
  })
  it('sorts plain dates and timezone-free timestamps as Beijing time', () => {
    expect(sortJournals([
      entry('midnight', '2026-10-01', ''),
      entry('utc', '2026-09-30T16:30:00Z', ''),
      entry('local', '2026-10-01 00:15:00', ''),
    ]).map(item => item.id)).toEqual(['utc', 'local', 'midnight'])
    expect(toDateTimeLocal('')).toBe('')
  })
  it('preserves seconds when ordering entries within the same minute', () => {
    expect(sortJournals([
      entry('a', '2026-09-30T22:00:01+08:00', ''),
      entry('z', '2026-09-30T14:00:59Z', ''),
    ]).map(item => item.id)).toEqual(['z', 'a'])
  })
})
