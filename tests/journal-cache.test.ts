import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheJournal, cachedJournal, journalCache, refreshJournalList, removeCachedJournal } from '../app/journal/journalCache'
import type { JournalEntry } from '../app/journal/journalData'

const entry = (id: string, content = id): JournalEntry => ({ id, content, name: id, author: '共同', created: '2026-09-30', event_time: '2026-09-30', locked: false })
beforeEach(() => { journalCache.entries = null; journalCache.details.clear() })
afterEach(() => vi.unstubAllGlobals())

describe('shared journal cache', () => {
  it('renders a cached list entry immediately and shares one in-flight refresh', async () => {
    journalCache.entries = [entry('a')]
    expect(cachedJournal('a')?.content).toBe('a')
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([entry('b')])))
    vi.stubGlobal('fetch', fetcher)
    const first = refreshJournalList()
    expect(refreshJournalList()).toBe(first)
    await first
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cachedJournal('b')?.content).toBe('b')
    expect(cachedJournal('a')).toBeNull()
  })
  it.each(['save', 'delete'])('a stale list response cannot undo a %s', async action => {
    const original = entry('a')
    journalCache.entries = [original]
    let respond!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve })))
    const pending = refreshJournalList()
    if (action === 'save') cacheJournal(entry('a', 'saved'))
    else removeCachedJournal('a')
    respond(new Response(JSON.stringify([original])))
    await pending
    expect(cachedJournal('a')?.content ?? null).toBe(action === 'save' ? 'saved' : null)
  })
  it('invalidates an older detail when the background list reports an update', async () => {
    cacheJournal({ ...entry('a'), updated_at: 'old' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ ...entry('a', 'new'), updated_at: 'new' }]))))
    await refreshJournalList()
    expect(cachedJournal('a')?.content).toBe('new')
  })
  it('keeps cached content available after a refresh failure', async () => {
    journalCache.entries = [entry('a')]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    await expect(refreshJournalList()).rejects.toThrow('读取日记失败')
    expect(cachedJournal('a')?.content).toBe('a')
  })
})
