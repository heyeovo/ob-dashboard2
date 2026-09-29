import { BucketCard } from './MemoryCard'
import { QUICK_FILTERS, isFeel } from './memoryFilters'
import type { Bucket, QuickFilter } from './memoryTypes'

export default function MemoryGrid({ displayed, quickFilter, sortBy, sortOrder, gridViewMode, onOpen, onRestoreNoise }: { displayed: Bucket[]; quickFilter: QuickFilter; sortBy: 'score' | 'importance' | 'created'; sortOrder: 'desc' | 'asc'; gridViewMode: 'list' | 'card'; onOpen: (id: string) => void; onRestoreNoise: (id: string) => void }) {
  const GridSection = ({ title, items }: { title: string, items: Bucket[] }) => {
    if (items.length === 0) return null;
    let sortedItems = [...items];
    sortedItems.sort((a, b) => {
      let result = 0;
      if (sortBy === 'score') {
        result = (b.score ?? 0) - (a.score ?? 0);
      } else if (sortBy === 'importance') {
        result = (b.importance ?? 0) - (a.importance ?? 0);
      } else if (sortBy === 'created') {
        result = new Date(b.created).getTime() - new Date(a.created).getTime();
      }
      return sortOrder === 'desc' ? result : -result;
    });
    return (
      <div className="mb-8 sm:mb-10">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-5">
          <span className="text-sm sm:text-base font-semibold text-[var(--color-text-primary)] italic">{title}</span>
          <span className="text-xs text-[var(--color-text-disabled)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md">{sortedItems.length} 条</span>
          <div className="flex-1 h-px bg-[var(--color-border)]"></div>
        </div>
        {gridViewMode === 'list' ? (
          <div className="space-y-2 sm:space-y-3">
            {sortedItems.map(b => <BucketCard key={b.id} b={b} onOpen={onOpen} onRestoreNoise={onRestoreNoise} />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
            {sortedItems.map(b => <BucketCard key={b.id} b={b} onOpen={onOpen} onRestoreNoise={onRestoreNoise} />)}
          </div>
        )}
      </div>
    )
  }

  return (
              <div>
                {quickFilter === 'all' ? (
                  <>
                    <GridSection title="★ 钉选记忆" items={displayed.filter(b => b.pinned && !isFeel(b))} />
                    <GridSection title="♦ 重要 (imp ≥ 7)" items={displayed.filter(b => !b.pinned && Number(b.importance) >= 7 && !b.resolved && !b.digested && !isFeel(b))} />
                    <GridSection title="feel" items={displayed.filter(b => isFeel(b) && !b.resolved && !b.digested)} />
                    <GridSection title="已解决" items={displayed.filter(b => !b.pinned && b.resolved)} />
                    <GridSection title="已消化" items={displayed.filter(b => !b.pinned && !b.resolved && b.digested)} />
                    <GridSection title="已归档" items={displayed.filter(b => b.type === 'archived')} />
                    <GridSection title="其他记忆" items={displayed.filter(b => !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested && !isFeel(b))} />
                  </>
                ) : (
                  <GridSection title={QUICK_FILTERS.find(f => f.key === quickFilter)?.label || ''} items={displayed} />
                )}
              </div>

  )
}
