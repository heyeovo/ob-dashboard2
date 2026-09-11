'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CcSessionListItem } from './types'
import {
  historicalKey,
  historicalSourceLabel,
  type HistoricalConversation,
  type HistoricalConversationResponse,
} from './historicalChats'

// 会话列表。数据来自 /api/cc-turns（Haven 的 conversation_turns）。
//
// ⚠️ 列表里会同时出现 Polaris 经 /v1/messages 写进去的会话（source='gateway'）——
// 那是对的，同一张表就是「单一数据源」那条硬约束达成的样子。用标签区分来源。

type Props = {
  sessions: CcSessionListItem[]
  deletedSessions: CcSessionListItem[]
  deletedSessionsTotal: number
  deletedSessionsLoadingMore: boolean
  activeSessionId: string
  activeHistoricalKey: string
  loading: boolean
  onPick: (sessionId: string) => void
  onPickHistorical: (conversation: HistoricalConversation) => void
  onNew: () => void
  onRename: (sessionId: string, title: string) => Promise<boolean>
  onPin: (sessionId: string, pinned: boolean) => Promise<boolean>
  onDelete: (sessionId: string) => Promise<boolean>
  onPermanentDelete: (sessionId: string) => Promise<boolean>
  onLoadMoreDeleted: () => Promise<void>
  variant?: 'rail' | 'mobile-page'
  notice?: string
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
  deletedSessionsTotal,
  deletedSessionsLoadingMore,
  activeSessionId,
  activeHistoricalKey,
  loading,
  onPick,
  onPickHistorical,
  onNew,
  onRename,
  onPin,
  onDelete,
  onPermanentDelete,
  onLoadMoreDeleted,
  variant = 'rail',
  notice = '',
}: Props) {
  const [menuId, setMenuId] = useState('')
  const [historicalOpen, setHistoricalOpen] = useState(false)
  const [historicalLoading, setHistoricalLoading] = useState(true)
  const [historicalError, setHistoricalError] = useState('')
  const [historical, setHistorical] = useState<HistoricalConversation[]>([])
  const [deletedOpen, setDeletedOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<'main' | 'historical' | 'deleted'>('main')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch('/api/historical-chats?limit=500', {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await res.json() as HistoricalConversationResponse
        if (!res.ok || !data.ok) throw new Error(data.error || `读取失败（${res.status}）`)
        setHistorical(data.items)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setHistoricalError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setHistoricalLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [])

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

  const pin = async (session: CcSessionListItem) => {
    if (await onPin(session.session_id, !session.pinned_at)) setMenuId('')
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

  const sessionItem = (session: CcSessionListItem, featured = false) => {
    const isCc = session.source === 'cc'
    return (
      <div
        key={session.session_id}
        className={`cc-rail-item relative mb-1 w-full px-3 py-3 ${
          featured
            ? 'border border-[var(--color-primary)] bg-[var(--color-primary-muted)] shadow-[var(--shadow-sm)]'
            : session.session_id === activeSessionId ? 'active' : ''
        }`}
      >
        <div className="flex items-start gap-1">
          <button type="button" onClick={() => onPick(session.session_id)} className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{session.title || session.session_id}</span>
              {featured ? (
                <span className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-1.5 py-px text-[10px] text-[var(--color-primary)]">主窗</span>
              ) : null}
              {!isCc ? (
                <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-[10px] text-[var(--color-text-tertiary)]">
                  {session.source === 'gateway' || session.source === 'polaris' ? 'Polaris' : session.source}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-disabled)]">{session.turn_count} 轮 · {relativeTime(session.last_at)}</div>
          </button>
          <button
            type="button"
            aria-label={`管理 ${session.title || session.session_id}`}
            onClick={() => setMenuId(current => current === session.session_id ? '' : session.session_id)}
            className="rounded px-1.5 py-0.5 text-sm text-[var(--color-text-disabled)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text-secondary)]"
          >
            ⋯
          </button>
        </div>
        {menuId === session.session_id ? (
          <div className="absolute right-1 top-9 z-30 w-40 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-xs shadow-[var(--shadow-md)]">
            <button type="button" onClick={() => void pin(session)} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-[var(--color-surface-secondary)]">
              {session.pinned_at ? '取消置顶' : '置顶为主窗'}
            </button>
            <button type="button" onClick={() => void rename(session)} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-[var(--color-surface-secondary)]">重命名</button>
            <button type="button" onClick={() => void copySessionId(session.session_id)} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-[var(--color-surface-secondary)]">复制 Session ID</button>
            <button type="button" onClick={() => void remove(session)} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]">删除窗口</button>
          </div>
        ) : null}
      </div>
    )
  }

  const pinnedSession = sessions.find(session => Boolean(session.pinned_at))
  const regularSessions = sessions.filter(session => session.session_id !== pinnedSession?.session_id)

  if (variant === 'mobile-page') {
    if (mobileSection === 'historical') {
      return (
        <div className="flex h-full flex-col bg-[var(--color-bg)]">
          <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-4 py-3">
            <button type="button" onClick={() => setMobileSection('main')} className="rounded-full px-2 py-1 text-sm text-[var(--color-text-secondary)]">←</button>
            <h1 className="text-sm font-medium text-[var(--color-text-heading)]">历史聊天</h1>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-3">
            {historicalLoading ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史聊天</div>
            ) : historicalError ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger)]">{historicalError}</div>
            ) : historical.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">没有历史聊天</div>
            ) : historical.map(item => (
              <button key={historicalKey(item)} type="button" onClick={() => onPickHistorical(item)} className="cc-rail-item mb-1 block w-full px-3 py-3 text-left">
                <div className="truncate text-[13px] text-[var(--color-text-primary)]">{item.title || '未命名历史窗口'}</div>
                <div className="mt-1 text-[11px] text-[var(--color-text-disabled)]">{historicalSourceLabel(item.source, item.client)} · {item.message_count} 条 · {relativeTime(item.last_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )
    }
    if (mobileSection === 'deleted') {
      return (
        <div className="flex h-full flex-col bg-[var(--color-bg)]">
          <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-4 py-3">
            <button type="button" onClick={() => setMobileSection('main')} className="rounded-full px-2 py-1 text-sm text-[var(--color-text-secondary)]">←</button>
            <h1 className="text-sm font-medium text-[var(--color-text-heading)]">已删除窗口</h1>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto space-y-2 px-3 py-3">
            {deletedSessions.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">没有已删除窗口</div>
            ) : deletedSessions.map(session => (
              <div key={session.session_id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
                <div className="truncate text-[13px] text-[var(--color-text-primary)]">{session.title || session.session_id}</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[9px] text-[var(--color-text-disabled)]">{session.session_id}</span>
                  <button type="button" onClick={() => void permanentlyRemove(session)} className="shrink-0 text-[11px] text-[var(--color-danger)]">永久删除</button>
                </div>
              </div>
            ))}
            {deletedSessions.length < deletedSessionsTotal ? (
              <button
                type="button"
                disabled={deletedSessionsLoadingMore}
                onClick={() => void onLoadMoreDeleted()}
                className="w-full rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-2.5 text-xs text-[var(--color-primary)] disabled:opacity-50"
              >
                {deletedSessionsLoadingMore ? '加载中…' : `加载更多（还有 ${deletedSessionsTotal - deletedSessions.length} 个）`}
              </button>
            ) : null}
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col bg-[var(--color-bg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-4 py-3">
          <div>
            <h1 className="text-base font-medium text-[var(--color-text-heading)]">对话</h1>
            <div className="mt-0.5 text-[10.5px] text-[var(--color-text-disabled)]">{loading ? '正在同步窗口…' : `${sessions.length} 个窗口`}</div>
          </div>
          <button type="button" onClick={onNew} className="rounded-full bg-[var(--color-primary)] px-3.5 py-2 text-xs font-medium text-white">新对话</button>
        </div>
        {notice ? <div className="mx-3 mt-3 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] px-3 py-2 text-[11px] text-[var(--color-primary)]">{notice}</div> : null}
        <div className="no-scrollbar flex-1 overflow-y-auto px-3 pb-5 pt-3">
          <div className="mb-2 text-[10.5px] text-[var(--color-text-disabled)]">主窗</div>
          {pinnedSession ? sessionItem(pinnedSession, true) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-center text-[11px] text-[var(--color-text-disabled)]">从任一对话右侧菜单中选择“置顶为主窗”</div>
          )}
          <div className="mb-2 mt-5 text-[10.5px] text-[var(--color-text-disabled)]">最近对话</div>
          {regularSessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--color-text-disabled)]">还没有其他对话</div>
          ) : regularSessions.map(session => sessionItem(session))}
          <div className="mt-5 space-y-2 border-t border-[var(--color-border-light)] pt-3">
            <button type="button" onClick={() => setMobileSection('historical')} className="flex w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-3 text-left text-xs text-[var(--color-text-secondary)]">
              <span>历史聊天</span><span className="text-[var(--color-text-disabled)]">{historicalLoading ? '…' : historical.length} ›</span>
            </button>
            <button type="button" onClick={() => setMobileSection('deleted')} className="flex w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-3 text-left text-xs text-[var(--color-text-secondary)]">
              <span>已删除窗口</span><span className="text-[var(--color-text-disabled)]">{deletedSessionsTotal} ›</span>
            </button>
          </div>
        </div>
      </div>
    )
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
            className="rounded-full bg-[var(--color-primary-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-hover-soft)]"
          >
            新对话
          </button>
        </div>
      </div>

      {notice ? <div className="mx-2 mb-2 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] px-2.5 py-2 text-[10.5px] text-[var(--color-primary)]">{notice}</div> : null}

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">加载中</div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">还没有对话</div>
        ) : (
          [...sessions]
            .sort((a, b) => Number(Boolean(b.pinned_at)) - Number(Boolean(a.pinned_at)))
            .map(session => sessionItem(session, Boolean(session.pinned_at)))
        )}

        <div className="mt-3 border-t border-[var(--color-border-light)] pt-2">
          <button
            type="button"
            onClick={() => setHistoricalOpen(value => !value)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]"
          >
            <span>历史聊天</span>
            <span>{historicalLoading ? '…' : historical.length} {historicalOpen ? '⌃' : '⌄'}</span>
          </button>
          {historicalOpen ? (
            <div className="mt-1 space-y-0.5">
              {historicalLoading ? (
                <div className="px-2.5 py-3 text-center text-[11px] text-[var(--color-text-disabled)]">读取历史窗口</div>
              ) : historicalError ? (
                <div className="px-2.5 py-3 text-[11px] text-[var(--color-danger)]">{historicalError}</div>
              ) : historical.length === 0 ? (
                <div className="px-2.5 py-3 text-center text-[11px] text-[var(--color-text-disabled)]">没有历史聊天</div>
              ) : historical.map(item => {
                const key = historicalKey(item)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onPickHistorical(item)}
                    className={`cc-rail-item block w-full px-2.5 py-2 text-left ${key === activeHistoricalKey ? 'active' : ''}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
                        {item.title || '未命名历史窗口'}
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-[10px] text-[var(--color-text-tertiary)]">
                        {historicalSourceLabel(item.source, item.client)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">
                      {item.message_count} 条 · {relativeTime(item.last_at)}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="mt-2 border-t border-[var(--color-border-light)] pt-2">
          <button
            type="button"
            onClick={() => setDeletedOpen(value => !value)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]"
          >
            <span>已删除窗口</span>
            <span>{deletedSessionsTotal} {deletedOpen ? '⌃' : '⌄'}</span>
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
              {deletedSessions.length < deletedSessionsTotal ? (
                <button
                  type="button"
                  disabled={deletedSessionsLoadingMore}
                  onClick={() => void onLoadMoreDeleted()}
                  className="w-full rounded-[var(--radius-md)] px-2.5 py-2 text-[11px] text-[var(--color-primary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-50"
                >
                  {deletedSessionsLoadingMore ? '加载中…' : `加载更多（还有 ${deletedSessionsTotal - deletedSessions.length} 个）`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
