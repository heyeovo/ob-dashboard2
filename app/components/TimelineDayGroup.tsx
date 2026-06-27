'use client'
import type { ReactNode } from 'react'

interface TimelineDayGroupProps {
  /** e.g. "23 Jun 2026 · 周六" — 统一日期字符串 */
  date: string
  count: number
  expanded?: boolean
  onToggle?: () => void
  unit?: string
  children: ReactNode
}

export default function TimelineDayGroup({
  date, count, expanded = true, onToggle, unit = '条', children,
}: TimelineDayGroupProps) {
  return (
    <div className="relative pl-2 mb-6">
      {/* 极细浅灰空气线 */}
      {expanded && (
        <div className="absolute left-0 top-2.5 bottom-0 w-[1px] bg-slate-200/60" />
      )}

      {/* 空心呼吸圆点（与文本居中对齐） */}
      {expanded && (
        <div className="absolute left-0 top-2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-[var(--color-primary)] bg-white ring-4 ring-orange-50 shadow-[0_0_6px_rgba(217,119,87,0.15)] z-[1]" />
      )}

      {/* 日期头 */}
      <div
        className={`flex items-center gap-2.5 mb-4 ml-4 select-none ${onToggle ? 'cursor-pointer' : ''}`}
        onClick={onToggle}
      >
        {onToggle && (
          <span className="text-xs text-[var(--color-primary)] leading-none w-3 text-center">
            {expanded ? '▼︎' : '▶︎'}
          </span>
        )}
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {date}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md font-medium">
          {count} {unit}
        </span>
      </div>

      {/* 卡片列表 */}
      {expanded && (
        <div className="space-y-3 ml-1">
          {children}
        </div>
      )}
    </div>
  )
}
