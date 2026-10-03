import { bucketDate } from '@/app/lib/dailyBucketDate'
import type { Bucket } from './memoryTypes'

function ImportanceDots({ importance }: { importance: number }) {
  const filled = Math.round(Math.max(0, Math.min(10, Number(importance) || 0)) / 2)
  return <span className="memory-importance" aria-label={`重要度 ${importance}`}>
    {Array.from({ length: 5 }, (_, index) => <i key={index} className={index < filled ? 'is-filled' : ''} />)}
  </span>
}

export const SkeletonCard = () => <div className="memory-card animate-pulse h-28" aria-hidden="true" />

export function BucketCard({ b, onOpen, compact = false }: {
  b: Bucket; onOpen: (id: string) => void; compact?: boolean
}) {
  const date = bucketDate(b)
  const tags = [...(b.domain ?? []), ...(b.tags ?? [])].filter((tag, index, all) => all.indexOf(tag) === index).slice(0, 2)
  const rings = Number(b.comment_count) || 0
  const states = [
    b.pinned && '已钉选',
    b.digested && '已消化',
    b.resolved && '已解决',
    b.type === 'archived' && '已归档',
    b.wish && '悬念中',
    (b.noise || (b.resolved && b.importance === 1)) && '噪声',
  ].filter(Boolean)
  return <button type="button" onClick={() => onOpen(b.id)} className={`memory-card ${compact ? 'memory-card-grid' : ''} ${(b.noise || (b.resolved && b.importance === 1)) ? 'memory-card-muted' : ''}`}>
    {compact ? <span className="memory-card-title">{b.pinned && <span className="memory-pin">★ </span>}{b.name}</span> : <span className="flex items-start justify-between gap-2">
      <span className="memory-card-title min-w-0 flex-1">{b.pinned && <span className="memory-pin">★ </span>}{b.name}</span>
      {states.length > 0 && <span className="flex max-w-[50%] shrink-0 flex-wrap justify-end gap-1">{states.map(state => <span key={String(state)} className="bucket-state text-meta whitespace-nowrap">{state}</span>)}</span>}
    </span>}
    <span className="memory-card-preview">{b.content_preview}</span>
    <span className="memory-card-footer">
      {!compact && <span className="memory-card-tags">{tags.map((tag, index) => <span key={tag}>{index > 0 && ' · '}{tag}</span>)}</span>}
      <span className="memory-card-meta">
        {rings > 0 && <span className="memory-rings">◎ {rings}</span>}
        {!compact && date && <span>{Number(date.slice(5, 7))}.{Number(date.slice(8, 10))}</span>}
        <ImportanceDots importance={b.importance} />
        {compact && date && <span>{Number(date.slice(5, 7))}.{Number(date.slice(8, 10))}</span>}
      </span>
    </span>
  </button>
}
