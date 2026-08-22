'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import CcMessageRow from './CcMessageRow'
import type { CcPersona } from './persona'
import type { CcMessage } from './types'
import {
  historicalSourceLabel,
  type HistoricalConversation,
  type HistoricalMessage,
  type HistoricalMessageResponse,
} from './historicalChats'

const PAGE_SIZE = 50

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN')
}

export type ForwardedBlock = {
  title: string
  lines: string[]
}

type Props = {
  conversation: HistoricalConversation
  persona: CcPersona
  onOpenRail: () => void
  onForward?: (block: ForwardedBlock) => void
}

function formatMessageTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

export default function CcHistoricalChat({ conversation, persona, onOpenRail, onForward }: Props) {
  const [messages, setMessages] = useState<HistoricalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const doForward = () => {
    if (!onForward || selected.size === 0) return
    const picked = messages
      .filter(m => selected.has(m.id))
      .map(m => {
        const speaker = m.role === 'user' ? '小羊' : '言之'
        return `[${formatMessageTime(m.created_at)}] ${speaker}: ${m.text}`
      })
    onForward({
      title: conversation.title || '历史聊天',
      lines: picked,
    })
    setSelectMode(false)
    setSelected(new Set())
  }

  const loadPage = useCallback(async (offset: number, append: boolean, signal?: AbortSignal) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    const params = new URLSearchParams({
      conversation_id: conversation.conversation_id,
      source: conversation.source,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    if (query) params.set('q', query)
    try {
      const res = await fetch(`/api/historical-chats?${params.toString()}`, {
        cache: 'no-store',
        signal,
      })
      const data = await res.json() as HistoricalMessageResponse
      if (!res.ok || !data.ok) throw new Error(data.error || `读取失败（${res.status}）`)
      setMessages(current => append ? [...current, ...data.items] : data.items)
      setHasMore(Boolean(data.has_more))
      setTotal(Number(data.total || 0))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [conversation.conversation_id, conversation.source, query])

  useEffect(() => {
    const controller = new AbortController()
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0 })
      void loadPage(0, false, controller.signal)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      controller.abort()
    }
  }, [loadPage])

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    void loadPage(messages.length, true)
  }, [hasMore, loadPage, loading, loadingMore, messages.length])

  useEffect(() => {
    const node = sentinelRef.current
    const root = scrollRef.current
    if (!node || !root || !hasMore) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore()
    }, { root, rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const uiMessages = useMemo<CcMessage[]>(() => messages.map(message => ({
    id: `historical-${message.id}`,
    role: message.role,
    text: message.text,
    thinking: typeof message.metadata?.thinking === 'string' ? message.metadata.thinking : '',
    createdAt: Date.parse(message.created_at) || 0,
    fromHistory: true,
  })), [messages])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  const clearSearch = () => {
    setQueryDraft('')
    setQuery('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="cc-topbar flex items-center gap-2 px-3 py-2.5 md:gap-3 md:px-4">
        <button
          type="button"
          onClick={onOpenRail}
          className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] md:hidden"
        >
          对话
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
              {conversation.title || '未命名历史窗口'}
            </span>
            <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-1.5 py-px text-[10px] text-[var(--color-text-tertiary)]">
              {historicalSourceLabel(conversation.source, conversation.client)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-disabled)]">
            历史聊天 · {formatDate(conversation.first_at)} · {conversation.message_count} 条消息
          </div>
        </div>
        {onForward ? (
          <button
            type="button"
            onClick={() => { setSelectMode(prev => !prev); setSelected(new Set()) }}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] ${selectMode ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'border-[var(--color-border)] bg-white text-[var(--color-text-tertiary)]'}`}
          >
            {selectMode ? '取消选择' : '选择'}
          </button>
        ) : (
          <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10px] text-[var(--color-text-tertiary)]">
            只读
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto flex max-w-[var(--chat-assistant-width)] flex-col gap-7">
          {loading ? (
            <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史聊天</div>
          ) : error && uiMessages.length === 0 ? (
            <div className="rounded-[var(--radius-lg)] bg-[#FCEEED] px-3.5 py-2.5 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          ) : uiMessages.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--color-text-disabled)]">
              {query ? '这个窗口里没有匹配的原文' : '这个历史窗口没有可显示的消息'}
            </div>
          ) : (
            uiMessages.map((message, idx) => (
              <div key={message.id} className={`flex items-start gap-2 ${selectMode ? 'cursor-pointer' : ''}`} onClick={selectMode ? () => toggleSelect(messages[idx].id) : undefined}>
                {selectMode ? (
                  <div className="flex shrink-0 pt-1">
                    <input
                      type="checkbox"
                      checked={selected.has(messages[idx].id)}
                      onChange={() => toggleSelect(messages[idx].id)}
                      onClick={e => e.stopPropagation()}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <CcMessageRow
                    message={message}
                    isCurrentTurn={false}
                    persona={persona}
                    onCopy={text => void navigator.clipboard?.writeText(text)}
                    searchQuery={query}
                  />
                </div>
              </div>
            ))
          )}
          {error && uiMessages.length > 0 ? (
            <div className="rounded-[var(--radius-lg)] bg-[#FCEEED] px-3.5 py-2.5 text-center text-xs text-[var(--color-danger)]">
              <div>{error}</div>
              <button type="button" onClick={loadMore} className="mt-1.5 underline">重新加载</button>
            </div>
          ) : null}
          {hasMore ? (
            <div ref={sentinelRef} className="py-2 text-center text-xs text-[var(--color-text-disabled)]">
              {loadingMore ? '正在加载后续消息…' : '继续向下滚动加载'}
            </div>
          ) : !loading && uiMessages.length > 0 ? (
            <div className="py-2 text-center text-[11px] text-[var(--color-text-disabled)]">
              已显示全部 {total} 条{query ? '匹配消息' : '消息'}
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-4 pb-4 pt-1">
        {selectMode && selected.size > 0 ? (
          <div className="mx-auto flex max-w-[var(--chat-assistant-width)] items-center justify-between rounded-2xl border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-4 py-2.5 shadow-sm">
            <span className="text-xs text-[var(--color-primary)]">已选 {selected.size} 条消息</span>
            <button
              type="button"
              onClick={doForward}
              className="rounded-full bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium text-white"
            >
              转发到当前对话
            </button>
          </div>
        ) : (
          <form onSubmit={submitSearch} className="mx-auto flex max-w-[var(--chat-assistant-width)] items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white px-3 py-2 shadow-sm">
            <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.3" />
              <path d="m15.5 15.5 4 4" />
            </svg>
            <input
              type="search"
              value={queryDraft}
              onChange={event => setQueryDraft(event.target.value)}
              placeholder="搜索这个历史窗口"
              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
            />
            {query || queryDraft ? (
              <button type="button" onClick={clearSearch} className="px-1 text-sm text-[var(--color-text-tertiary)]" aria-label="清除搜索">×</button>
            ) : null}
            <button type="submit" className="rounded-full bg-[var(--color-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]">
              搜索
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
