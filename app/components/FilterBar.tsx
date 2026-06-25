'use client'
import type { ReactNode } from 'react'

/**
 * Filter button row container — rounded border with subtle background.
 * Usage: <FilterBar>{filterButtons}</FilterBar>
 */
export default function FilterBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-y-3 gap-x-4 ${className}`}>
      {children}
    </div>
  )
}

/**
 * Single filter pill button — active/inactive states.
 */
export function FilterPill({ label, active, onClick, className = '', children }: {
  label: string; active: boolean; onClick: () => void; className?: string; children?: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full border transition-all whitespace-nowrap flex items-center gap-1 ${active
        ? 'bg-[var(--color-text-primary)] border-[var(--color-text-primary)] text-white'
        : 'bg-white border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[#C4C1BC] hover:bg-[var(--color-surface-secondary)]'} ${className}`}>
      {label}
      {children}
    </button>
  )
}
