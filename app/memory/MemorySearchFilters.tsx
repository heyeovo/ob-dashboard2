import FilterBar, { FilterPill } from '../components/FilterBar'
import { QUICK_FILTERS } from './memoryFilters'
import type { QuickFilter } from './memoryTypes'

export default function MemoryFilters({ activeTab, search, onSearchChange, statusCounts, quickFilter, setQuickFilter, activeTag, setActiveTag, topTags, categories, activeCategory, setActiveCategory }: { activeTab: 'timeline' | 'grid'; search: string; onSearchChange: (value: string) => void; statusCounts: Record<QuickFilter, number>; quickFilter: QuickFilter; setQuickFilter: (value: QuickFilter) => void; activeTag: string | null; setActiveTag: (value: string | null) => void; topTags: string[]; categories: string[]; activeCategory: string; setActiveCategory: (value: string) => void }) {
  return (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-3 sm:p-4 shadow-sm mb-4">
              <div className="relative w-full mb-3 sm:mb-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-disabled)]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="8.5" cy="8.5" r="6" /><path d="M13.5 13.5L18 18" />
                </svg>
                <input
                  className="w-full bg-[var(--color-surface-secondary)] border border-transparent rounded-xl pl-8 pr-4 py-2.5 text-sm outline-none focus:bg-[var(--color-surface)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all placeholder-[var(--color-text-disabled)]"
                  placeholder="搜索记忆、标签或内容..."
                  value={search}
                  onChange={e => onSearchChange(e.target.value)}
                />
              </div>
              <div className="w-full h-px bg-[var(--color-border-light)] mb-3 sm:mb-4"></div>

              <FilterBar>
                {QUICK_FILTERS.map(f => (
                  <FilterPill key={f.key} label={`${f.label} ${statusCounts[f.key]}`} active={quickFilter === f.key} onClick={() => setQuickFilter(f.key)} />
                ))}
              </FilterBar>

              {/* 下排：分类标签 */}
              {categories.length > 0 && (
                <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar mt-3">
                    {/* “全部” 按钮 */}
                    <button onClick={() => setActiveCategory('')}
                      // 加上了 transition-all 确保动画一致
                      className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full transition-all border whitespace-nowrap ${
                        // 统一了选中与未选中的边框颜色及 hover 效果
                        activeCategory === ''
                          ? 'bg-[var(--color-text-primary)] border-[var(--color-text-primary)] text-[var(--color-on-primary)]'
                          : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-secondary)]'
                      }`}>
                      全部
                    </button>

                    {/* 动态分类循环 */}
                    {categories.map(c => (
                      <button key={c} onClick={() => setActiveCategory(c)}
                        // 加上了 transition-all 确保动画一致
                        className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full transition-all border whitespace-nowrap ${
                          // 统一了选中与未选中的边框颜色及 hover 效果
                          activeCategory === c
                            ? 'bg-[var(--color-text-primary)] border-[var(--color-text-primary)] text-[var(--color-on-primary)]'
                            : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-secondary)]'
                        }`}>{c}</button>
                    ))}
                  </div>
                )}

              {activeTab === 'grid' && (
                <div className="flex gap-1.5 sm:gap-2 mt-4 pt-4 border-t border-[var(--color-border-light)] overflow-x-auto no-scrollbar">
                  <button onClick={() => setActiveTag(activeTag === 'feel' ? null : 'feel')}
                    className={`text-xs px-2.5 sm:px-3 py-1 rounded-md whitespace-nowrap ${
                      activeTag === 'feel' ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)]'
                    }`}>
                    feel
                  </button>
                  {topTags.map(t => (
                    <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)}
                      className={`text-xs px-2.5 sm:px-3 py-1 rounded-md whitespace-nowrap ${
                        activeTag === t ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)]'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
  )
}
