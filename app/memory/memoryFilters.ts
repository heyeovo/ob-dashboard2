import { formatBeijingDate, getBeijingDayOfWeek } from '@/app/utils/format'
import type { Bucket, QuickFilter, DatePreset } from './memoryTypes'

// ==================== 工具函数 ====================
export const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '★ 钉选' },
  { key: 'important', label: '重要' },
  { key: 'feel', label: 'feel' },
  { key: 'digested', label: '已消化' },
  { key: 'resolved', label: '已解决' },
  { key: 'archived', label: '已归档' },
  { key: 'noise', label: '🔇 噪声' },
  { key: 'other', label: '其他记忆' },
]

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: '全部时间' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 3 个月' },
  { key: 'custom', label: '自定义' },
]

export const isFeel = (b: Bucket) =>
  b.type === 'feel' || (b.domain ?? []).includes('feel') || (b.domain ?? []).includes('沉淀物') || (b.tags ?? []).includes('feel')

export const isJourney = (b: Bucket) => (b.domain ?? []).includes('journey')

export function matchesQuickFilter(b: Bucket, f: QuickFilter): boolean {
  switch (f) {
    case 'all': return true
    case 'pinned': return b.pinned && !isFeel(b)
    case 'important': return Number(b.importance) >= 7 && !b.pinned
    case 'feel': return isFeel(b)
    case 'digested': return !!b.digested
    case 'resolved': return b.resolved
    case 'archived': return b.type === 'archived'
    case 'noise': return !!b.noise || (b.resolved && b.importance === 1)
    case 'other': return !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested && !isFeel(b)
  }
}

export function matchesDateFilter(b: Bucket, preset: DatePreset, start: string, end: string): boolean {
  if (preset === 'all') return true
  const t = new Date(b.created).getTime()
  const now = Date.now()
  if (preset === '7d') return t > now - 7 * 86400000
  if (preset === '30d') return t > now - 30 * 86400000
  if (preset === '90d') return t > now - 90 * 86400000
  if (preset === 'custom') {
    const s = start ? new Date(start).getTime() : 0
    const e = end ? new Date(end).getTime() + 86400000 : Infinity
    return t >= s && t <= e
  }
  return true
}

function formatReviewDate(dateStr: string) {
  if (!dateStr) return '—'
  const datePart = formatBeijingDate(dateStr) // e.g. "2026/06/08"
  const dayOfWeek = getBeijingDayOfWeek(dateStr) // e.g. "周一"
  const parts = datePart.split('/')
  const day = parseInt(parts[2], 10)
  const monthNum = parseInt(parts[1], 10) - 1 // 0-indexed
  const year = parts[0]
  const monthShort = new Date(Date.UTC(2000, monthNum)).toLocaleDateString('en', { month: 'short' })
  return `${day} ${monthShort} ${year} · ${dayOfWeek}`
}

export function formatDateGroup(dateStr: string) {
  if (dateStr === 'unknown') return '未知时间'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return '未知时间'
  return formatReviewDate(dateStr)
}

export function getTopTags(buckets: Bucket[], n = 10): string[] {
  if (!Array.isArray(buckets)) return [];
  const freq = new Map<string, number>();
  for (const b of buckets)
    for (const t of b.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

export function groupByDate(buckets: Bucket[]) {
  const map = new Map<string, Bucket[]>()
  for (const b of buckets) {
    const eventTime = b.event_time || b.created || ''
    const d = eventTime ? eventTime.slice(0, 10) : 'unknown'
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(b)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        const aTime = a.event_time || a.created || ''
        const bTime = b.event_time || b.created || ''
        return new Date(bTime).getTime() - new Date(aTime).getTime()
      })
    }))
}

// 在 groupByDate 下方新增一个函数
export function groupByMonth(buckets: Bucket[]) {
  const map = new Map<string, Bucket[]>()
  for (const b of buckets) {
    const d = ((b.event_time || b.created) ?? '').slice(0, 7) || 'unknown'  // 取 YYYY-MM
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(b)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))   // 月份倒序
    .map(([month, items]) => {
      // 对每个月内的 buckets 再按天分组（复用原逻辑）
      const days = groupByDate(items)   // 返回 { date, items }[]
      return { month, days }
    })
}
