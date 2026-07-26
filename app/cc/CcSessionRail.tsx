'use client'
import type { CcSessionListItem } from './types'

// 会话列表。数据来自 /api/cc-turns（Haven 的 conversation_turns）。
//
// ⚠️ 列表里会同时出现 Polaris 经 /v1/messages 写进去的会话（source='gateway'）——
// 那是对的，同一张表就是「单一数据源」那条硬约束达成的样子。用标签区分来源。

type Props = {
  sessions: CcSessionListItem[]
  activeSessionId: string
  loading: boolean
  onPick: (sessionId: string) => void
  onNew: () => void
}

function relativeTime(iso: string) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

export default function CcSessionRail({ sessions, activeSessionId, loading, onPick, onNew }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-xs font-medium text-[var(--color-text-tertiary)]">对话</span>
        <button
          type="button"
          onClick={onNew}
          className="rounded-full bg-[var(--color-primary-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-primary)] transition-colors hover:bg-[#FBE5DE]"
        >
          新对话
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">加载中</div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">还没有对话</div>
        ) : (
          sessions.map(s => {
            const isCc = s.source === 'cc'
            return (
              <button
                key={s.session_id}
                type="button"
                onClick={() => onPick(s.session_id)}
                className={`cc-rail-item mb-0.5 block w-full px-2.5 py-2 text-left ${
                  s.session_id === activeSessionId ? 'active' : ''
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] text-[var(--color-text-primary)]">
                    {s.title || s.session_id}
                  </span>
                  {!isCc ? (
                    <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-[10px] text-[var(--color-text-tertiary)]">
                      {s.source === 'gateway' ? 'Polaris' : s.source}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">
                  {s.turn_count} 轮 · {relativeTime(s.last_at)}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
