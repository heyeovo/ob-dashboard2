import { BucketCard } from './MemoryCard'
import { formatDateGroup } from './memoryFilters'
import type { Bucket } from './memoryTypes'

type MonthGroup = { month: string; days: { date: string; items: Bucket[] }[] }

export default function MemoryTimeline({ monthlyGroups, collapsedMonths, collapsedDates, toggleMonthCollapse, toggleDateCollapse, onOpen, onRestoreNoise }: { monthlyGroups: MonthGroup[]; collapsedMonths: Set<string>; collapsedDates: Set<string>; toggleMonthCollapse: (month: string) => void; toggleDateCollapse: (date: string) => void; onOpen: (id: string) => void; onRestoreNoise: (id: string) => void }) {
  return (
              <div>
                {monthlyGroups.map(({ month, days }, index) => {
                  const isMonthCollapsed = collapsedMonths.has(month);
                  return (
                    <div key={month} className="mb-8">
                      {/* 核心改动：只有非第一个月份（index > 0），才在下方单独渲染月份标题行 */}
                      {index > 0 && (
                        <div className="flex items-center gap-2 mb-4 ml-[calc(1rem-7px)] cursor-pointer select-none" onClick={() => toggleMonthCollapse(month)}>
                          <h2 className="text-xl font-bold italic font-serif text-[var(--color-primary)] leading-tight whitespace-nowrap">
                            {month.replace('-', '·')}
                          </h2>
                          <span className="text-xs text-[var(--color-text-disabled)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md">
                            {days.reduce((sum, d) => sum + d.items.length, 0)} 条
                          </span>
                        </div>
                      )}

                      {/* 日期列表（折叠时隐藏） */}
                      {!isMonthCollapsed && (
                        <div className={`relative pl-2 ${index === 0 ? 'mt-0' : 'mt-1'}`}>
                          {days.map(({ date, items }) => {
                            const isDayCollapsed = collapsedDates.has(date);
                            return (
                              <div key={date} className="relative pl-2 mb-6">
                                {/* 折叠箭头 */}
                                <button
                                  onClick={() => toggleDateCollapse(date)}
                                  className="absolute -left-[7px] top-2 -translate-y-1/2 text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors z-[1]"
                                >
                                  <span className={`leading-none ${isDayCollapsed ? 'text-xs' : 'text-sm'}`}>
                                    {isDayCollapsed ? '▶︎' : '▼︎'}
                                  </span>
                                </button>

                                {/* 日期标签 */}
                                <button
                                  onClick={() => toggleDateCollapse(date)}
                                  className="flex items-center gap-3 mb-4 ml-1 cursor-pointer hover:text-[var(--color-primary)] transition-colors text-left w-full"
                                >
                                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                                    {formatDateGroup(date)}
                                  </span>
                                  <span className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md font-medium">
                                    {items.length} 条
                                  </span>
                                </button>

                                {!isDayCollapsed && (
                                  <>
                                    {/* 极细空气线 */}
                                    <div className="absolute left-0 top-2.5 bottom-0 w-[1px] bg-[var(--color-surface-tertiary)]/60" />
                                    {/* 空心呼吸圆点 */}
                                    <div className="absolute left-0 top-2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-[var(--color-primary)] bg-[var(--color-surface)] ring-4 ring-[var(--color-primary-light)] shadow-[var(--shadow-timeline-dot)] z-[1]" />
                                    <div className="space-y-3 ml-1">
                                      {items.map(b => <BucketCard key={b.id} b={b} onOpen={onOpen} onRestoreNoise={onRestoreNoise} />)}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
  )
}
