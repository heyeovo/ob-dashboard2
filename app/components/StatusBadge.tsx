'use client'

type StatusType = 'pinned' | 'resolved' | 'digested' | 'archived' | 'noise' | 'feel' | 'wish'

const STATUS_MAP: Record<StatusType, { label: string; fg: string; bg: string }> = {
  pinned:   { label: '已钉选', fg: 'var(--color-pinned)',    bg: 'var(--color-pinned-bg)' },
  resolved: { label: '已解决', fg: 'var(--color-resolved)',  bg: 'var(--color-resolved-bg)' },
  digested: { label: '已消化', fg: 'var(--color-digested)',  bg: 'var(--color-digested-bg)' },
  archived: { label: '已归档', fg: 'var(--color-archived)',  bg: 'var(--color-archived-bg)' },
  noise:    { label: '噪声',   fg: 'var(--color-noise)',     bg: 'var(--color-noise-bg)' },
  feel:     { label: 'feel',   fg: 'var(--color-feel)',      bg: 'var(--color-feel-bg)' },
  wish:     { label: '悬念',   fg: 'var(--color-wish)',      bg: 'var(--color-wish-bg)' },
}

export function statusLabel(bucket: {
  noise?: boolean; pinned?: boolean; resolved?: boolean
  digested?: boolean; wish?: boolean; type?: string; importance?: number
}): StatusType | null {
  if (bucket.noise || (bucket.resolved && bucket.importance === 1)) return 'noise'
  if (bucket.pinned) return 'pinned'
  if (bucket.digested) return 'digested'
  if (bucket.type === 'archived') return 'archived'
  if (bucket.resolved) return 'resolved'
  if (bucket.wish) return 'wish'
  return null
}

/**
 * Status badge pill — compact label for bucket states.
 * Usage: <StatusBadge type="resolved" /> or <StatusBadge type="resolved" label="已解决" />
 */
export default function StatusBadge({ type, label, size = 'sm', onClick }: {
  type: StatusType; label?: string; size?: 'sm' | 'xs'; onClick?: () => void
}) {
  const s = STATUS_MAP[type]
  const text = label ?? s.label
  return (
    <span
      className={`rounded-full font-medium inline-block whitespace-nowrap ${size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} ${onClick ? 'cursor-pointer hover:opacity-70 active:scale-95 transition-all' : ''}`}
      style={{ backgroundColor: s.bg, color: s.fg }}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
    >
      {text}
    </span>
  )
}
