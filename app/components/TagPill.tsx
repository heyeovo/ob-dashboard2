'use client'

/**
 * Tag pill — for domain/tags display (NOT bucket status).
 * Usage: <TagPill text="游戏" variant="domain" /> or <TagPill text="JSX" variant="tag" />
 */
export default function TagPill({ text, variant = 'domain' }: {
  text: string; variant?: 'domain' | 'tag'
}) {
  if (variant === 'tag') {
    return (
      <span className="text-xs border border-[var(--color-border)] px-2 py-0.5 rounded-md text-[var(--color-text-secondary)] whitespace-nowrap">
        {text}
      </span>
    )
  }
  return (
    <span className="text-xs bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md text-[var(--color-text-secondary)] whitespace-nowrap">
      {text}
    </span>
  )
}
