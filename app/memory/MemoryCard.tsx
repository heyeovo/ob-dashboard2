import StatusBadge from '../components/StatusBadge'
import { formatBeijingDate } from '@/app/utils/format'
import { isFeel } from './memoryFilters'
import type { Bucket } from './memoryTypes'

function ImpSignal({ importance }: { importance: number | string | undefined }) {
    const maxBars = 5
    const num = Number(importance)
    if (importance == null || isNaN(num)) {
      return <span className="text-xs text-[var(--color-text-disabled)] font-medium">—</span>
    }
    const value = Math.max(0, Math.min(num, 10)) / 2
    const fullBars = Math.floor(value)
    const remainder = value - fullBars

    return (
      <div className="flex items-center">
        <div className="flex gap-px">
          {Array.from({ length: maxBars }).map((_, i) => {
            let opacity: number
            if (i < fullBars) {
              opacity = 1
            } else if (i === fullBars && remainder > 0) {
              opacity = 0.3 + remainder * 0.7
            } else {
              opacity = 0.12
            }
            return (
              <div
                key={i}
                className="w-1 h-2 rounded-[1px]"
                style={{
                  backgroundColor: `color-mix(in srgb, var(--color-primary) ${opacity * 100}%, transparent)`,
                }}
              />
            )
          })}
        </div>
        <span className="text-xs text-[var(--color-primary)] font-medium tabular-nums leading-none ml-0.5">
          {Math.round(num)}
        </span>
      </div>
    )
  }
export const SkeletonCard = () => (
    <div className="bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-border-light)]/50 rounded-2xl p-4 sm:p-6 border border-[var(--color-border)] w-full animate-pulse">
      <div className="flex items-start justify-between mb-1 gap-3">
        <div className="flex-1 min-w-0">
          <div className="h-5 bg-[var(--color-border)] rounded-md w-2/3 mb-2" />
          <div className="h-4 bg-[var(--color-border-light)] rounded-md w-full mb-1" />
          <div className="h-4 bg-[var(--color-border-light)] rounded-md w-3/4" />
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className="h-5 w-16 bg-[var(--color-border-light)] rounded-full" />
          <div className="h-3 w-12 bg-[var(--color-border-light)] rounded-md" />
        </div>
      </div>
      <div className="flex gap-1.5 mt-3">
        <div className="h-5 w-12 bg-[var(--color-border-light)] rounded-md" />
        <div className="h-5 w-16 bg-[var(--color-border-light)] rounded-md" />
        <div className="h-5 w-10 bg-[var(--color-border-light)] rounded-md" />
      </div>
    </div>
  )
export const BucketCard = ({ b, onOpen, onRestoreNoise }: { b: Bucket; onOpen: (id: string) => void; onRestoreNoise: (id: string) => void }) => (
  <div
    onClick={() => onOpen(b.id)}
    className={`bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-border-light)]/50 rounded-2xl p-4 sm:p-6 hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5 cursor-pointer border transition-all duration-300 group w-full relative active:scale-[0.985] touch-pan-y ${
      (b.noise || (b.resolved && b.importance === 1))
        ? 'border-[var(--color-border)] opacity-50 saturate-50'
        : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30'
    }`}
  >
    <div className="flex items-start justify-between mb-1 gap-2 sm:gap-3">
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap pr-14 sm:pr-0">
        {b.pinned && <span className="text-[var(--color-primary)] text-xs sm:text-sm flex-shrink-0">★</span>}
        <span className="font-semibold text-[var(--color-text-primary)] text-sm sm:text-base truncate group-hover:text-[var(--color-primary)] transition-colors">
          {b.name}
        </span>
        {isFeel(b) && <StatusBadge type="feel" />}
        {b.digested && <StatusBadge type="digested" />}
        {b.resolved && !(b.noise || (b.resolved && b.importance === 1)) && <StatusBadge type="resolved" />}
        {b.type === 'archived' && <StatusBadge type="archived" />}
        {(b.noise || (b.resolved && b.importance === 1)) && (
          <StatusBadge type="noise" onClick={() => {
            onRestoreNoise(b.id)
          }} />
        )}
        {b.wish && <StatusBadge type="wish" />}
        {b.todo && !b.todo_done && <span title={`待办：${b.todo}`} className="text-xs text-[var(--color-primary)] flex-shrink-0">☐</span>}
      </div>
      <div className="absolute top-3 right-3 sm:static flex flex-col items-end gap-1.5 flex-shrink-0">
        <div className="min-w-[48px] sm:min-w-[56px] bg-[var(--color-primary-light)] rounded-full px-2 sm:px-2.5 py-0.5 flex items-center justify-center">
          <span className="text-xs text-[var(--color-primary)] font-medium leading-tight">
            score {b.score != null ? b.score.toFixed(1) : '—'}
          </span>
        </div>
        <ImpSignal importance={b.importance} />
      </div>
    </div>
    <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] line-clamp-2 mb-2.5 sm:mb-4 leading-relaxed pr-16 sm:pr-20">
      {b.content_preview}
    </p>

    <div className="flex items-end justify-between mb-0 gap-2 sm:gap-3">
      <div className="flex flex-wrap gap-1 sm:gap-1.5">
        {(b.domain ?? []).map(d => (
          <span key={d} className="text-xs bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[var(--color-text-secondary)]">{d}</span>
        ))}
        {(b.tags ?? []).slice(0, 2).map(t => (
          <span key={t} className="text-xs border border-[var(--color-border)] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[var(--color-text-tertiary)]">{t}</span>
        ))}
        {(b.tags ?? []).length > 2 && (
          <span className="text-xs text-[var(--color-text-disabled)] py-0.5 px-1">+{(b.tags ?? []).length - 3}</span>
        )}
      </div>
      {b.last_active && (
        <span className="text-xs text-[var(--color-text-disabled)] flex-shrink-0">
           {formatBeijingDate(b.last_active)}
        </span>
      )}
    </div>
  </div>
)
