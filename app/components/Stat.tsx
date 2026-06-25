'use client'

/**
 * Stat grid cell — label + value in a compact card.
 * Usage: <Stat label="新建记忆" value={42} />
 */
export default function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[var(--color-surface-secondary)] rounded-xl px-3 py-2.5">
      <div className="text-[10px] text-[var(--color-text-disabled)] mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}
