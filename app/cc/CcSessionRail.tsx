'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { CcSessionListItem } from './types'

// 会话列表。数据来自 /api/cc-turns（Haven 的 conversation_turns）。
//
// ⚠️ 列表里会同时出现 Polaris 经 /v1/messages 写进去的会话（source='gateway'）——
// 那是对的，同一张表就是「单一数据源」那条硬约束达成的样子。用标签区分来源。

type Props = {
  sessions: CcSessionListItem[]
  deletedSessions: CcSessionListItem[]
  activeSessionId: string
  loading: boolean
  onPick: (sessionId: string) => void
  onNew: () => void
  onRename: (sessionId: string, title: string) => Promise<boolean>
  onDelete: (sessionId: string) => Promise<boolean>
  onPermanentDelete: (sessionId: string) => Promise<boolean>
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

export default function CcSessionRail({
  sessions,
  deletedSessions,
  activeSessionId,
  loading,
  onPick,
  onNew,
  onRename,
  onDelete,
  onPermanentDelete,
}: Props) {
  const [menuId, setMenuId] = useState('')
  const [deletedOpen, setDeletedOpen] = useState(false)

  const copySessionId = async (sessionId: string) => {
    await navigator.clipboard.writeText(sessionId)
    setMenuId('')
  }

  const rename = async (session: CcSessionListItem) => {
    const title = window.prompt('修改窗口标题', session.title || '')
    if (!title?.trim()) return
    if (await onRename(session.session_id, title)) setMenuId('')
  }

  const remove = async (session: CcSessionListItem) => {
    const confirmed = window.confirm(`删除窗口“${session.title || session.session_id}”？\n\n窗口会从列表隐藏，对话原文和 Persona 历史仍会保留。`)
    if (!confirmed) return
    if (await onDelete(session.session_id)) setMenuId('')
  }

  const permanentlyRemove = async (session: CcSessionListItem) => {
    const label = session.title || session.session_id
    const first = window.confirm(
      `永久删除窗口“${label}”？\n\n这会删除该窗口的全部对话与窗口状态，无法恢复；长期记忆桶不会被删除。`,
    )
    if (!first) return
    const typed = window.prompt(`二次确认：请输入完整 Session ID\n${session.session_id}`)
    if (typed?.trim() !== session.session_id) {
      window.alert('Session ID 不一致，未执行永久删除。')
      return
    }
    await onPermanentDelete(session.session_id)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-xs font-medium text-[var(--color-text-tertiary)]">对话</span>
        <div className="flex items-center gap-1.5">
          <Link href="/cc/import" className="rounded-full px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]">导入</Link>
          <button
            type="button"
            onClick={onNew}
            className="rounded-full bg-[var(--color-primary-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-primary)] transition-colors hover:bg-[#FBE5DE]"
          >
            新对话
          </button>
        </div>
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
              <div
                key={s.session_id}
                className={`cc-rail-item relative mb-0.5 w-full px-2.5 py-2 ${
                  s.session_id === activeSessionId ? 'active' : ''
                }`}
              >
                <div className="flex items-start gap-1">
                  <button type="button" onClick={() => onPick(s.session_id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] text-[var(--color-text-primary)]">{s.title || s.session_id}</span>
                      {!isCc ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-[10px] text-[var(--color-text-tertiary)]">
                          {s.source === 'gateway' || s.source === 'polaris' ? 'Polaris' : s.source}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">{s.turn_count} 轮 · {relativeTime(s.last_at)}</div>
                  </button>
                  <button
                    type="button"
                    aria-label={`管理 ${s.title || s.session_id}`}
                    onClick={() => setMenuId(current => current === s.session_id ? '' : s.session_id)}
                    className="rounded px-1.5 py-0.5 text-sm text-[var(--color-text-disabled)] hover:bg-white hover:text-[var(--color-text-secondary)]"
                  >
                    ⋯
                  </button>
                </div>
                {menuId === s.session_id ? (
                  <div className="absolute right-1 top-8 z-30 w-36 rounded-xl border border-[var(--color-border)] bg-white p-1 text-xs shadow-lg">
                    <button type="button" onClick={() => void rename(s)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--color-surface-secondary)]">重命名</button>
                    <button type="button" onClick={() => void copySessionId(s.session_id)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--color-surface-secondary)]">复制 Session ID</button>
                    <button type="button" onClick={() => void remove(s)} className="block w-full rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50">删除窗口</button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}

        <div className="mt-3 border-t border-[var(--color-border-light)] pt-2">
          <button
            type="button"
            onClick={() => setDeletedOpen(value => !value)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]"
          >
            <span>已删除窗口</span>
            <span>{deletedSessions.length} {deletedOpen ? '⌃' : '⌄'}</span>
          </button>
          {deletedOpen ? (
            <div className="mt-1 space-y-1">
              {deletedSessions.length === 0 ? (
                <div className="px-2.5 py-3 text-center text-[11px] text-[var(--color-text-disabled)]">没有已删除窗口</div>
              ) : deletedSessions.map(session => (
                <div key={session.session_id} className="rounded-lg bg-[var(--color-surface-secondary)] px-2.5 py-2">
                  <div className="truncate text-[11px] text-[var(--color-text-secondary)]">{session.title || session.session_id}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[9px] text-[var(--color-text-disabled)]">{session.session_id}</span>
                    <button
                      type="button"
                      onClick={() => void permanentlyRemove(session)}
                      className="shrink-0 text-[10px] text-rose-600 hover:underline"
                    >
                      永久删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
