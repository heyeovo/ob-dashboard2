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
  return <button type="button" onClick={() => onOpen(b.id)} className={`memory-card ${compact ? 'memory-card-grid' : ''} ${(b.noise || (b.resolved && b.importance === 1)) ? 'memory-card-muted' : ''}`}>
    <span className="memory-card-title">{b.pinned && <span className="memory-pin">★ </span>}{b.name}</span>
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
