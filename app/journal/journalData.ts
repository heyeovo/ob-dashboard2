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
  return toDateTimeLocal(entry.event_time || entry.created).slice(0, 10)
}

export function sortJournals(entries: JournalEntry[]) {
  return [...entries].sort((a, b) => {
    const time = journalTimestamp(b.event_time || b.created) - journalTimestamp(a.event_time || a.created)
    return time || a.id.localeCompare(b.id)
  })
}

function journalTimestamp(value: string) {
  const text = value.trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00+08:00`).getTime()
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}+08:00`).getTime()
}

export function toDateTimeLocal(value: string) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00`
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (!match) return ''
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return `${match[1]}T${match[2]}`
  const date = new Date(text.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

export function toBeijingIso(value: string) {
  return value ? `${value}:00+08:00` : ''
}

export const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
