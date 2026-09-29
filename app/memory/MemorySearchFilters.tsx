import { DATE_PRESETS, QUICK_FILTERS } from './memoryFilters'
import type { DatePreset, QuickFilter } from './memoryTypes'

export default function MemoryFilters({ search, onSearchChange, statusCounts, quickFilter, setQuickFilter, datePreset, setDatePreset, customStart, setCustomStart, customEnd, setCustomEnd }: {
  search: string; onSearchChange: (value: string) => void; statusCounts: Record<QuickFilter, number>;
  quickFilter: QuickFilter; setQuickFilter: (value: QuickFilter) => void;
  datePreset: DatePreset; setDatePreset: (value: DatePreset) => void;
  customStart: string; setCustomStart: (value: string) => void; customEnd: string; setCustomEnd: (value: string) => void
}) {
  return <div className="mb-4">
    <label className="memory-search flex items-center gap-2 px-3.5">
      <svg className="w-4 h-4 text-[var(--color-text-tertiary)] flex-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="6" /><path d="M13.5 13.5L18 18" /></svg>
      <input aria-label="搜索记忆" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="搜索记忆、标签或内容…" className="w-full min-w-0 bg-transparent outline-none text-base md:text-sm placeholder:text-[var(--color-text-tertiary)]" />
    </label>
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-2.5">
      {QUICK_FILTERS.map(filter => <button key={filter.key} type="button" aria-pressed={quickFilter === filter.key} onClick={() => setQuickFilter(filter.key)} className="memory-filter-pill flex-none px-3 py-1 text-xs whitespace-nowrap">{filter.label} <span className="opacity-60">{statusCounts[filter.key]}</span></button>)}
      <select aria-label="时间范围" value={datePreset} onChange={event => setDatePreset(event.target.value as DatePreset)} className="memory-filter-pill flex-none px-3 py-1 text-xs outline-none cursor-pointer">
        {DATE_PRESETS.map(preset => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
      </select>
    </div>
    {datePreset === 'custom' && <div className="flex gap-2 pb-2">
      <input aria-label="开始日期" type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} className="memory-search px-2 text-base md:text-sm min-w-0 flex-1" />
      <input aria-label="结束日期" type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} className="memory-search px-2 text-base md:text-sm min-w-0 flex-1" />
    </div>}
  </div>
}
