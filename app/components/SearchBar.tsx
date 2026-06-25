'use client'

/**
 * Unified search input — pill shape, consistent across all pages.
 * Usage: <SearchBar value={q} onChange={setQ} placeholder="搜索..." />
 */
interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  className?: string
}

export default function SearchBar({ value, onChange, onKeyDown, placeholder = '搜索关键词...', className = '' }: SearchBarProps) {
  return (
    <div className={`bg-white border border-[var(--color-border)] rounded-full px-3.5 py-2 flex items-center gap-2 flex-1 ${className}`}>
      <svg className="w-3.5 h-3.5 text-[var(--color-text-disabled)] flex-shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="5.5" cy="5.5" r="4.5" />
        <path d="M9 9l4 4" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm outline-none text-[var(--color-text-primary)] placeholder-[var(--color-text-disabled)]"
      />
      {value && (
        <button onClick={() => onChange('')} className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] text-sm flex-shrink-0">
          ×
        </button>
      )}
    </div>
  )
}
