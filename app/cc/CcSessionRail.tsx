'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  personaName: string
  personaInitial: string
}

function sessionMode(session: CcSessionListItem) {
  return session.local_engine_preference === 'selfhost' ? '自建' : session.mode === 'work' ? 'WORK' : 'CHAT'
}

function clockTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false })
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-HK', { month: 'numeric', day: 'numeric' })
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
  personaName,
  personaInitial,
}: Props) {
  const [menuId, setMenuId] = useState('')
  const [historicalOpen, setHistoricalOpen] = useState(false)
  const [historicalLoading, setHistoricalLoading] = useState(true)
  const [historicalError, setHistoricalError] = useState('')
  const [historical, setHistorical] = useState<HistoricalConversation[]>([])
  const [deletedOpen, setDeletedOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<'main' | 'historical' | 'deleted'>('main')
  const [pinnedPreview, setPinnedPreview] = useState('')
  const mobilePaneRef = useRef<HTMLDivElement>(null)

  const pinnedId = sessions.find(session => session.pinned_at)?.session_id || ''
  useEffect(() => {
    if (!pinnedId) { setPinnedPreview(''); return }
    setPinnedPreview('')
    const viewport = window.matchMedia('(min-width: 768px)')
    let controller: AbortController | null = null
    const loadVisible = () => {
      controller?.abort()
      if (viewport.matches !== (variant === 'rail')) return
      controller = new AbortController()
      const active = controller
      void fetch(`/api/cc-turns?session_id=${encodeURIComponent(pinnedId)}&limit=1`, { cache: 'no-store', signal: active.signal })
        .then(async response => {
          const data = await response.json() as { ok?: boolean; turns?: { assistant_text?: string; user_text?: string }[] }
          if (!active.signal.aborted && response.ok && data.ok) {
            const turn = data.turns?.at(-1)
            setPinnedPreview((turn?.assistant_text || turn?.user_text || '').trim())
          }
        }).catch(() => { if (!active.signal.aborted) setPinnedPreview('') })
    }
    loadVisible()
    viewport.addEventListener('change', loadVisible)
    return () => { controller?.abort(); viewport.removeEventListener('change', loadVisible) }
  }, [pinnedId, variant])

  useLayoutEffect(() => {
    if (variant !== 'mobile-page') return
    const pane = mobilePaneRef.current
    const header = pane?.querySelector<HTMLElement>('.cc-mobile-list-topbar')
    if (!pane || !header) return
    const updateHeight = () => pane.style.setProperty('--cc-header-height', `${header.getBoundingClientRect().height}px`)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(header)
    return () => observer.disconnect()
  }, [variant, mobileSection])

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
    return (
      <div
        key={session.session_id}
        className={`relative w-full px-3 py-2.5 ${featured ? 'cc-main-session mb-4 rounded-[var(--radius-2xl)]' : 'cc-session-line'}`}
      >
        <div className="relative flex min-w-0 items-center gap-1">
          {!featured ? <span className={`cc-session-dot ${sessionMode(session) === 'WORK' ? 'work' : ''}`} /> : null}
          <button type="button" onClick={() => onPick(session.session_id)} className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1">
              <span className="truncate text-note font-medium text-[var(--color-text-primary)]">{featured ? personaName : session.title || session.session_id}</span>
              <span className={`cc-mode-cap ${sessionMode(session) === 'CHAT' ? 'chat' : ''}`}>{sessionMode(session)}</span>
            </div>
            {featured ? <div className="mt-1 text-2xs text-[var(--color-text-tertiary)]">主窗 · {session.turn_count.toLocaleString()} 轮</div> : null}
          </button>
          <span className="shrink-0 text-2xs text-[var(--color-text-tertiary)]">{clockTime(session.last_at)}</span>
          <button
            type="button"
            aria-label={`管理 ${session.title || session.session_id}`}
            onClick={() => setMenuId(current => current === session.session_id ? '' : session.session_id)}
            className="flex size-11 shrink-0 items-center justify-center text-sm text-[var(--color-text-tertiary)]"
          >
            ⋯
          </button>
        </div>
        {featured ? <button type="button" onClick={() => onPick(session.session_id)} className="relative mt-2 line-clamp-2 w-full text-left text-meta text-[var(--color-text-secondary)]">{pinnedPreview || '打开主窗继续对话'}</button> : null}
        {menuId === session.session_id ? (
          <div className="cc-popmenu absolute right-1 top-9 z-30 w-40 p-1 text-xs">
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
        <div ref={mobilePaneRef} className="cc-mobile-pane flex h-full flex-col">
          <div className="cc-mobile-list-topbar flex items-center gap-3 border-b border-[var(--color-border-light)] px-4 py-3">
            <button type="button" onClick={() => setMobileSection('main')} className="rounded-full px-2 py-1 text-sm text-[var(--color-text-secondary)]">←</button>
            <h1 className="text-sm font-medium text-[var(--color-text-heading)]">历史聊天</h1>
          </div>
          <div className="cc-mobile-list-scroll no-scrollbar flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
            {historicalLoading ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史聊天</div>
            ) : historicalError ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger)]">{historicalError}</div>
            ) : historical.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">没有历史聊天</div>
            ) : historical.map(item => (
              <button key={historicalKey(item)} type="button" onClick={() => onPickHistorical(item)} className="cc-rail-item mb-1 block w-full px-3 py-3 text-left">
                <div className="truncate text-note text-[var(--color-text-primary)]">{item.title || '未命名历史窗口'}</div>
                <div className="mt-1 text-meta text-[var(--color-text-disabled)]">{historicalSourceLabel(item.source, item.client)} · {item.message_count} 条 · {relativeTime(item.last_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )
    }
    if (mobileSection === 'deleted') {
      return (
        <div ref={mobilePaneRef} className="cc-mobile-pane flex h-full flex-col">
          <div className="cc-mobile-list-topbar flex items-center gap-3 border-b border-[var(--color-border-light)] px-4 py-3">
            <button type="button" onClick={() => setMobileSection('main')} className="rounded-full px-2 py-1 text-sm text-[var(--color-text-secondary)]">←</button>
            <h1 className="text-sm font-medium text-[var(--color-text-heading)]">已删除窗口</h1>
          </div>
          <div className="cc-mobile-list-scroll no-scrollbar flex-1 overflow-y-auto overflow-x-hidden space-y-2 px-3 py-3">
            {deletedSessions.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">没有已删除窗口</div>
            ) : deletedSessions.map(session => (
              <div key={session.session_id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
                <div className="truncate text-note text-[var(--color-text-primary)]">{session.title || session.session_id}</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-3xs text-[var(--color-text-disabled)]">{session.session_id}</span>
                  <button type="button" onClick={() => void permanentlyRemove(session)} className="shrink-0 text-meta text-[var(--color-danger)]">永久删除</button>
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
      <div ref={mobilePaneRef} className="cc-mobile-pane flex h-full flex-col">
        <div className="cc-mobile-list-topbar flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--color-text-heading)]">对话</h1>
            <div className="mt-1 text-2xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">{loading ? '正在同步窗口…' : `${sessions.length} WINDOWS`}</div>
          </div>
          <button type="button" onClick={onNew} aria-label="新对话" className="flex size-11 items-center justify-center rounded-full bg-[var(--color-primary)] text-xl text-[var(--color-on-primary)] shadow-[var(--glass-shadow)]">+</button>
        </div>
        <div className="cc-mobile-list-scroll no-scrollbar flex-1 overflow-y-auto overflow-x-hidden px-4 pb-5 pt-3">
          {notice ? <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] px-3 py-2 text-meta text-[var(--color-primary)]">{notice}</div> : null}
          {pinnedSession ? (
            <div className="cc-main-session relative overflow-visible rounded-[var(--radius-2xl)] p-3.5">
              <div className="relative flex items-start gap-2.5">
                <button type="button" onClick={() => onPick(pinnedSession.session_id)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--color-on-primary)]">{personaInitial}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate font-[family-name:var(--font-display)] text-md font-semibold">{personaName}</span><span className={`cc-mode-cap ${sessionMode(pinnedSession) === 'CHAT' ? 'chat' : ''}`}>{sessionMode(pinnedSession)}</span></span>
                    <span className="mt-0.5 block text-2xs text-[var(--color-text-tertiary)]">主窗 · {pinnedSession.turn_count.toLocaleString()} 轮</span>
                  </span>
                </button>
                <span className="shrink-0 pt-1 text-2xs text-[var(--color-text-tertiary)]">{clockTime(pinnedSession.last_at)}</span>
                <button type="button" aria-label="管理主窗" onClick={() => setMenuId(current => current === pinnedSession.session_id ? '' : pinnedSession.session_id)} className="flex size-11 shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">···</button>
              </div>
              <button type="button" onClick={() => onPick(pinnedSession.session_id)} className="relative mt-2.5 line-clamp-2 w-full text-left text-note text-[var(--color-text-secondary)]">{pinnedPreview || '打开主窗继续对话'}</button>
              {menuId === pinnedSession.session_id ? <div className="cc-popmenu absolute right-2 top-12 z-30 flex w-40 flex-col p-1">
                <button type="button" onClick={() => void pin(pinnedSession)} className="cc-popmenu-item text-left">取消置顶</button>
                <button type="button" onClick={() => void rename(pinnedSession)} className="cc-popmenu-item text-left">重命名</button>
                <button type="button" onClick={() => void remove(pinnedSession)} className="cc-popmenu-item text-left text-[var(--color-danger)]">删除窗口</button>
              </div> : null}
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-center text-meta text-[var(--color-text-disabled)]">从任一对话右侧菜单中选择“置顶为主窗”</div>
          )}
          <div className="mb-2 mt-5 px-1 text-2xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">RECENT</div>
          {regularSessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--color-text-disabled)]">还没有其他对话</div>
          ) : <div className="cc-session-group overflow-visible">
            {regularSessions.map(session => <div key={session.session_id} className="cc-session-line relative flex min-h-14 items-center gap-2.5 px-3">
              <span className={`cc-session-dot ${sessionMode(session) === 'WORK' ? 'work' : ''}`} aria-hidden="true" />
              <button type="button" onClick={() => onPick(session.session_id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{session.title || session.session_id}</span>
                <span className={`cc-mode-cap ${sessionMode(session) === 'CHAT' ? 'chat' : ''}`}>{sessionMode(session)}</span>
              </button>
              <span className="shrink-0 text-2xs text-[var(--color-text-tertiary)]">{session.turn_count.toLocaleString()} 轮 · {clockTime(session.last_at)}</span>
              <button type="button" aria-label={`管理 ${session.title || session.session_id}`} onClick={() => setMenuId(current => current === session.session_id ? '' : session.session_id)} className="flex size-11 shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">···</button>
              {menuId === session.session_id ? <div className="cc-popmenu absolute right-2 top-11 z-30 flex w-40 flex-col p-1">
                <button type="button" onClick={() => void pin(session)} className="cc-popmenu-item text-left">置顶为主窗</button>
                <button type="button" onClick={() => void rename(session)} className="cc-popmenu-item text-left">重命名</button>
                <button type="button" onClick={() => void remove(session)} className="cc-popmenu-item text-left text-[var(--color-danger)]">删除窗口</button>
              </div> : null}
            </div>)}
          </div>}
          <div className="mb-2 mt-5 px-1 text-2xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">MORE</div>
          <div className="cc-session-group overflow-hidden">
            <button type="button" onClick={() => setMobileSection('historical')} className="cc-session-line flex min-h-12 w-full items-center justify-between px-3 text-left text-note text-[var(--color-text-secondary)]">
              <span>历史聊天</span><span>{historicalLoading ? '…' : historical.length} ›</span>
            </button>
            <button type="button" onClick={() => setMobileSection('deleted')} className="cc-session-line flex min-h-12 w-full items-center justify-between px-3 text-left text-note text-[var(--color-text-secondary)]">
              <span>已删除窗口</span><span>{deletedSessionsTotal} ›</span>
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
          <Link href="/cc/import" className="rounded-full px-2 py-1 text-meta text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]">导入</Link>
          <button
            type="button"
            onClick={onNew}
            className="rounded-full bg-[var(--color-primary-soft)] px-2.5 py-1 text-meta font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-hover-soft)]"
          >
            新对话
          </button>
        </div>
      </div>

      {notice ? <div className="mx-2 mb-2 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] px-2.5 py-2 text-2xs text-[var(--color-primary)]">{notice}</div> : null}

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">加载中</div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">还没有对话</div>
        ) : (
          <>
            {pinnedSession ? sessionItem(pinnedSession, true) : null}
            <div className="mb-2 px-2 text-2xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">RECENT</div>
            <div className="cc-session-group">
              {regularSessions.map(session => sessionItem(session))}
            </div>
          </>
        )}

        <div className="mt-3 border-t border-[var(--color-border-light)] pt-2">
          <button
            type="button"
            onClick={() => setHistoricalOpen(value => !value)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-meta text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]"
          >
            <span>历史聊天</span>
            <span>{historicalLoading ? '…' : historical.length} {historicalOpen ? '⌃' : '⌄'}</span>
          </button>
          {historicalOpen ? (
            <div className="mt-1 space-y-0.5">
              {historicalLoading ? (
                <div className="px-2.5 py-3 text-center text-meta text-[var(--color-text-disabled)]">读取历史窗口</div>
              ) : historicalError ? (
                <div className="px-2.5 py-3 text-meta text-[var(--color-danger)]">{historicalError}</div>
              ) : historical.length === 0 ? (
                <div className="px-2.5 py-3 text-center text-meta text-[var(--color-text-disabled)]">没有历史聊天</div>
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
                      <span className="min-w-0 flex-1 truncate text-note text-[var(--color-text-primary)]">
                        {item.title || '未命名历史窗口'}
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-2xs text-[var(--color-text-tertiary)]">
                        {historicalSourceLabel(item.source, item.client)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-meta text-[var(--color-text-disabled)]">
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
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-meta text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]"
          >
            <span>已删除窗口</span>
            <span>{deletedSessionsTotal} {deletedOpen ? '⌃' : '⌄'}</span>
          </button>
          {deletedOpen ? (
            <div className="mt-1 space-y-1">
              {deletedSessions.length === 0 ? (
                <div className="px-2.5 py-3 text-center text-meta text-[var(--color-text-disabled)]">没有已删除窗口</div>
              ) : deletedSessions.map(session => (
                <div key={session.session_id} className="rounded-lg bg-[var(--color-surface-secondary)] px-2.5 py-2">
                  <div className="truncate text-meta text-[var(--color-text-secondary)]">{session.title || session.session_id}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-3xs text-[var(--color-text-disabled)]">{session.session_id}</span>
                    <button
                      type="button"
                      onClick={() => void permanentlyRemove(session)}
                      className="shrink-0 text-2xs text-[var(--color-danger)] hover:underline"
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
                  className="w-full rounded-[var(--radius-md)] px-2.5 py-2 text-meta text-[var(--color-primary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-50"
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
