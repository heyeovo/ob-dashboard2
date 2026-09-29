import { bucketDate } from '@/app/lib/dailyBucketDate'
import { BucketCard } from './MemoryCard'
import { isFeel } from './memoryFilters'
import type { Bucket, QuickFilter } from './memoryTypes'

export default function MemoryGrid({ displayed, quickFilter, sortBy, onOpen, onSelectFilter }: {
  displayed: Bucket[]; quickFilter: QuickFilter; sortBy: 'created' | 'importance';
  onOpen: (id: string) => void; onSelectFilter: (filter: QuickFilter) => void
}) {
  function sorted(items: Bucket[]) {
    return [...items].sort((a, b) => {
      const byImportance = Number(b.importance) - Number(a.importance)
      if (sortBy === 'importance' && byImportance) return byImportance
      return (bucketDate(b) ?? '').localeCompare(bucketDate(a) ?? '') || b.created.localeCompare(a.created)
    })
  }
  function GridSection({ title, items, filter }: { title: string; items: Bucket[]; filter: QuickFilter }) {
    if (!items.length) return null
    const ordered = sorted(items)
    const shown = quickFilter === 'all' ? ordered.slice(0, 4) : ordered
    return <section className="mb-6">
      <div className="flex items-baseline gap-2 py-3">
        <h2 className="text-base font-semibold tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>{title}</h2>
        <span className="ml-auto text-meta text-[var(--color-text-tertiary)]">{ordered.length} 条</span>
      </div>
      <div className="grid grid-cols-2 gap-[var(--memory-card-gap)]">{shown.map(bucket => <BucketCard key={bucket.id} b={bucket} compact onOpen={onOpen} />)}</div>
      {quickFilter === 'all' && <button type="button" onClick={() => onSelectFilter(filter)} className="block w-full text-center text-xs text-[var(--color-text-tertiary)] py-3">只看 {title} · 全部 {ordered.length} 条 ›</button>}
    </section>
  }
  const active = displayed.filter(bucket => !bucket.resolved && !bucket.digested && bucket.type !== 'archived')
  const groups: { title: string; filter: QuickFilter; items: Bucket[] }[] = [
    { title: '★ 钉选', filter: 'pinned', items: active.filter(bucket => bucket.pinned && !isFeel(bucket)) },
    { title: 'feel', filter: 'feel', items: active.filter(bucket => isFeel(bucket)) },
    { title: '重要', filter: 'important', items: active.filter(bucket => !bucket.pinned && !isFeel(bucket) && Number(bucket.importance) >= 7) },
    { title: '其他', filter: 'other', items: active.filter(bucket => !bucket.pinned && !isFeel(bucket) && Number(bucket.importance) < 7) },
  ]
  return <div>
    {quickFilter === 'all'
      ? groups.map(group => <GridSection key={group.filter} {...group} />)
      : <GridSection title={{ pinned: '★ 钉选', feel: 'feel', important: '重要', other: '其他' }[quickFilter as 'pinned' | 'feel' | 'important' | 'other'] ?? quickFilter} filter={quickFilter} items={displayed} />}
    {quickFilter === 'all' && <div className="flex items-center gap-2 flex-wrap border-t border-[var(--color-border-subtle)] pt-3 pb-5">
      <span className="text-xs text-[var(--color-text-tertiary)] mr-auto">已收起</span>
      {(['resolved', 'digested', 'archived'] as const).map(filter => {
        const count = displayed.filter(bucket => filter === 'resolved' ? bucket.resolved : filter === 'digested' ? bucket.digested : bucket.type === 'archived').length
        return <button key={filter} type="button" onClick={() => onSelectFilter(filter)} className="memory-filter-pill text-meta px-2.5 py-1">{{ resolved: '已解决', digested: '已消化', archived: '已归档' }[filter]} {count}</button>
      })}
    </div>}
  </div>
}
