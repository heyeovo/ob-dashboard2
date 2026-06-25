'use client'

/**
 * Compact number display for score / imp / weight / 激活 / token counts.
 * Usage: <DataBadge label="score" value={7.5} /> or <DataBadge label="imp" value={5} />
 */
export default function DataBadge({ label, value, size = 'sm' }: {
  label: string; value: number | string; size?: 'sm' | 'xs'
}) {
  const display = typeof value === 'number' ? value.toFixed(1) : value
  return (
    <span className={`bg-[var(--color-primary-soft)] rounded-full inline-flex items-center justify-center whitespace-nowrap ${size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'}`}>
      <span className="text-[var(--color-primary)] font-medium">
        {label} {display}
      </span>
    </span>
  )
}
