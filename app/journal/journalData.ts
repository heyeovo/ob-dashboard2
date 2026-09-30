export type JournalEntry = {
  id: string
  name: string
  author: string
  created: string
  updated_at?: string
  event_time: string
  locked: boolean
  content: string | null
  unlock_hint?: string
}

export type Author = '言之' | '小羊' | '共同'

export function journalDate(entry: JournalEntry) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(entry.event_time || entry.created))
  const value = (key: string) => parts.find(part => part.type === key)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function sortJournals(entries: JournalEntry[]) {
  return [...entries].sort((a, b) => {
    const time = new Date(b.event_time || b.created).getTime() - new Date(a.event_time || a.created).getTime()
    return time || a.id.localeCompare(b.id)
  })
}

export function toDateTimeLocal(value: string) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? `${match[1]}T${match[2]}` : ''
}

export function toBeijingIso(value: string) {
  return value ? `${value}:00+08:00` : ''
}

export const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
