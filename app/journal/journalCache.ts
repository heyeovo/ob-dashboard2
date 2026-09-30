import type { JournalEntry } from './journalData'
import type { getMonthChapters } from '@/app/memory/memoryFilters'

// 允许丢失的客户端运行态；列表和阅读页切换时复用，Haven 仍为事实源。
export const journalCache = {
  entries: null as JournalEntry[] | null,
  details: new Map<string, JournalEntry>(),
  chapters: {} as ReturnType<typeof getMonthChapters>,
  scroll: 0,
  restoreScroll: false,
  search: '',
}

let pendingList: Promise<JournalEntry[]> | null = null
let revision = 0
export function refreshJournalList() {
  if (pendingList) return pendingList
  const startedAt = revision
  pendingList = (async () => {
    const response = await fetch('/api/journal', { cache: 'no-store' })
    if (!response.ok) throw new Error('读取日记失败')
    const entries: JournalEntry[] = await response.json()
    if (startedAt === revision) {
      journalCache.entries = entries
      for (const [id, detail] of journalCache.details) {
        const item = entries.find(entry => entry.id === id)
        if (!item || item.updated_at !== detail.updated_at || item.event_time !== detail.event_time || item.locked !== detail.locked) journalCache.details.delete(id)
      }
    }
    return journalCache.entries || entries
  })().finally(() => { pendingList = null })
  return pendingList
}

export function cacheJournal(entry: JournalEntry, mutation = true) {
  if (mutation) revision++
  journalCache.details.set(entry.id, entry)
  if (journalCache.entries) {
    journalCache.entries = [...journalCache.entries.filter(item => item.id !== entry.id), entry]
  }
}

export function removeCachedJournal(id: string) {
  revision++
  journalCache.details.delete(id)
  if (journalCache.entries) journalCache.entries = journalCache.entries.filter(item => item.id !== id)
}

export function cachedJournal(id: string) {
  return journalCache.details.get(id) || journalCache.entries?.find(item => item.id === id) || null
}
