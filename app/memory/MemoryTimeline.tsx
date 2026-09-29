import { BucketCard } from './MemoryCard'
import { formatDateGroup, type MonthChapter } from './memoryFilters'
import type { Bucket } from './memoryTypes'

type MonthGroup = { month: string; days: { date: string; items: Bucket[] }[] }

export default function MemoryTimeline({ monthlyGroups, chapters, collapsedMonths, collapsedDates, toggleMonthCollapse, toggleDateCollapse, onOpen }: {
  monthlyGroups: MonthGroup[]; chapters: Record<string, MonthChapter>; collapsedMonths: Set<string>; collapsedDates: Set<string>;
  toggleMonthCollapse: (month: string) => void; toggleDateCollapse: (date: string) => void; onOpen: (id: string) => void
}) {
  return <div>
    {monthlyGroups.map(({ month, days }) => {
      const chapter = chapters[month]
      return <section key={month} className="mb-8">
        <button type="button" onClick={() => toggleMonthCollapse(month)} className="w-full text-left mt-5 mb-2" aria-expanded={!collapsedMonths.has(month)}>
          <span className="flex items-baseline gap-2">
            <span className="text-xl italic text-[var(--color-primary)] whitespace-nowrap" style={{ fontFamily: 'var(--font-display)' }}>{month.replace('-', '·')}</span>
            {chapter && <span className="text-base font-semibold tracking-widest" style={{ fontFamily: 'var(--font-display)' }}>{chapter.name}</span>}
            <span className="ml-auto text-meta text-[var(--color-text-tertiary)] whitespace-nowrap">{days.reduce((sum, day) => sum + day.items.length, 0)} 条</span>
          </span>
          {chapter?.description && <span className="block text-meta text-[var(--color-text-tertiary)] leading-relaxed mt-1">{chapter.description}</span>}
        </button>
        {!collapsedMonths.has(month) && days.map(({ date, items }) => {
          const formatted = formatDateGroup(date)
          const match = formatted.match(/^(\d+)\s+([A-Za-z]+)\s+\d{4}\s*·\s*(.*)$/)
          return <div key={date} className="mb-4">
            <button type="button" onClick={() => toggleDateCollapse(date)} aria-expanded={!collapsedDates.has(date)} className="w-full flex items-center gap-2 text-left py-2">
              <span className="text-2xl italic leading-none text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-display)' }}>{match ? match[1] : formatted}</span>
              {match && <span className="text-2xs uppercase tracking-widest text-[var(--color-text-tertiary)]">{match[2]} · {match[3]}</span>}
              <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
              <span className="text-meta text-[var(--color-text-tertiary)] whitespace-nowrap">{items.length} 条</span>
            </button>
            {!collapsedDates.has(date) && <div className="flex flex-col gap-[var(--memory-card-gap)]">{items.map(bucket => <BucketCard key={bucket.id} b={bucket} onOpen={onOpen} />)}</div>}
          </div>
        })}
      </section>
    })}
  </div>
}
