'use client'
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import CcMessageRow from './CcMessageRow'
import CcXhsCard, { extractXhsUrl } from './CcXhsCard'
import { CcPermCard } from './CcPermCard'
import { visibleChatDay } from './format'
import { MODE_LABEL } from '@/app/lib/ccModes'
import type { CcChatScope } from './CcChatScope'

function CcScrollJumps({
  children,
  sessionId,
  firstMessageId,
  lastMessageId,
  lastMessageVersion,
  pendingCount,
  layoutKey,
  onOpenSearch,
}: {
  children: ReactNode
  sessionId: string
  firstMessageId: string
  lastMessageId: string
  lastMessageVersion: string
  pendingCount: number
  /** 选择模式等会整体改变气泡宽度的状态；变化时把正在看的那条消息钉在原位 */
  layoutKey: string
  onOpenSearch?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null)
  const scrollTopRef = useRef(0)
  // iOS Safari 不支持 CSS scroll anchoring：进入选择模式时每行多出勾选框、气泡变窄、
  // 上方内容整体变高，画面会被推到很前面。滚动时记下屏幕中间那条消息，布局变化后按它复位。
  const anchorRef = useRef<{ id: string; top: number } | null>(null)
  const layoutKeyRef = useRef(layoutKey)
  const previousContentRef = useRef<{
    sessionId: string
    firstMessageId: string
    lastMessageId: string
    lastMessageVersion: string
    pendingCount: number
    scrollHeight: number
  } | null>(null)
  const [canGoUp, setCanGoUp] = useState(false)
  const [canGoDown, setCanGoDown] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [thumb, setThumb] = useState({ visible: false, top: 0, height: 0 })

  const update = useCallback(() => {
    const node = scrollRef.current
    if (!node) return
    scrollTopRef.current = node.scrollTop
    const rect = node.getBoundingClientRect()
    const probe = document.elementFromPoint(rect.left + rect.width * 0.3, rect.top + node.clientHeight / 2)
    const row = probe?.closest<HTMLElement>('[data-message-id]')
    anchorRef.current = row && node.contains(row)
      ? { id: row.dataset.messageId || '', top: row.getBoundingClientRect().top }
      : null
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    const nextCanGoUp = node.scrollTop > 24
    const nextCanGoDown = distanceFromBottom > 24
    setCanGoUp(current => current === nextCanGoUp ? current : nextCanGoUp)
    setCanGoDown(current => current === nextCanGoDown ? current : nextCanGoDown)
    const trackHeight = Math.max(0, node.clientHeight - 16)
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight)
    if (trackHeight === 0 || maxScrollTop === 0) {
      setThumb(current => current.visible ? { visible: false, top: 0, height: 0 } : current)
      return
    }
    const height = Math.max(48, trackHeight * (node.clientHeight / node.scrollHeight))
    const top = (node.scrollTop / maxScrollTop) * Math.max(0, trackHeight - height)
    setThumb(current =>
      current.visible && Math.abs(current.top - top) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { visible: true, top, height },
    )
  }, [])

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const previous = previousContentRef.current
    if (!previous || previous.sessionId !== sessionId) {
      node.scrollTop = node.scrollHeight
    } else if (
      previous.firstMessageId !== firstMessageId
      && previous.lastMessageId === lastMessageId
    ) {
      node.scrollTop = scrollTopRef.current + (node.scrollHeight - previous.scrollHeight)
    } else if (
      previous.lastMessageId !== lastMessageId
      || previous.lastMessageVersion !== lastMessageVersion
      || previous.pendingCount !== pendingCount
    ) {
      node.scrollTop = node.scrollHeight
    }
    scrollTopRef.current = node.scrollTop
    previousContentRef.current = {
      sessionId,
      firstMessageId,
      lastMessageId,
      lastMessageVersion,
      pendingCount,
      scrollHeight: node.scrollHeight,
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
    }
  }, [children, firstMessageId, lastMessageId, lastMessageVersion, pendingCount, sessionId, update])

  useLayoutEffect(() => {
    if (layoutKeyRef.current === layoutKey) return
    layoutKeyRef.current = layoutKey
    const node = scrollRef.current
    const anchor = anchorRef.current
    if (!node || !anchor?.id) return
    const row = Array.from(node.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find(item => item.dataset.messageId === anchor.id)
    if (row) node.scrollTop += row.getBoundingClientRect().top - anchor.top
    update()
  }, [layoutKey, update])

  const jump = (top: number) => {
    scrollRef.current?.scrollTo({ top, behavior: 'smooth' })
  }

  const beginThumbDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const node = scrollRef.current
    if (!node) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: node.scrollTop }
    setDragging(true)
  }

  const moveThumb = (event: PointerEvent<HTMLButtonElement>) => {
    const node = scrollRef.current
    const drag = dragRef.current
    if (!node || !drag || drag.pointerId !== event.pointerId) return
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight)
    const movableTrack = Math.max(1, node.clientHeight - 16 - thumb.height)
    node.scrollTop = Math.min(
      maxScrollTop,
      Math.max(0, drag.startScrollTop + ((event.clientY - drag.startY) / movableTrack) * maxScrollTop),
    )
  }

  const endThumbDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const useThumbKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const node = scrollRef.current
    if (!node) return
    const step = Math.max(80, node.clientHeight * 0.8)
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault()
      node.scrollBy({ top: -step, behavior: 'smooth' })
    } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault()
      node.scrollBy({ top: step, behavior: 'smooth' })
    } else if (event.key === 'Home') {
      event.preventDefault()
      jump(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      jump(node.scrollHeight)
    }
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div
        ref={scrollRef}
        onScroll={update}
        className="cc-thread-scroll no-scrollbar h-full max-w-full overflow-x-hidden overflow-y-auto px-4 py-6"
      >
        {children}
      </div>
      {thumb.visible ? (
        <div className="pointer-events-none absolute inset-y-2 right-0 z-10 w-10 md:hidden">
          <button
            type="button"
            aria-label="快速滚动对话"
            title="拖动快速浏览对话"
            onPointerDown={beginThumbDrag}
            onPointerMove={moveThumb}
            onPointerUp={endThumbDrag}
            onPointerCancel={endThumbDrag}
            onKeyDown={useThumbKeyboard}
            onContextMenu={event => event.preventDefault()}
            onDragStart={event => event.preventDefault()}
            className="pointer-events-auto absolute right-0 flex w-10 touch-none select-none justify-end pr-1"
            style={{
              top: thumb.top,
              height: thumb.height,
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
            }}
          >
            <span
              aria-hidden="true"
              className={`h-full w-2 rounded-full bg-[var(--color-text-tertiary)] shadow-sm transition-opacity ${dragging ? 'opacity-85' : 'opacity-45'}`}
            />
          </button>
        </div>
      ) : null}
      {onOpenSearch || canGoUp || canGoDown ? (
        <div className="cc-scroll-actions pointer-events-none absolute bottom-3 right-4 z-20 flex flex-col gap-1.5">
          {onOpenSearch ? (
            <button
              type="button"
              aria-label="搜索当前对话"
              title="搜索当前对话"
              onClick={onOpenSearch}
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/75 text-[var(--color-text-tertiary)] opacity-60 shadow-sm transition hover:opacity-95 md:hidden"
            >
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.3" />
                <path d="m15.5 15.5 4 4" />
              </svg>
            </button>
          ) : null}
          {canGoUp ? (
            <button
              type="button"
              aria-label="跳到对话顶部"
              title="跳到顶部"
              onClick={() => jump(0)}
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/75 text-[var(--color-text-tertiary)] opacity-60 shadow-sm transition hover:opacity-95"
            >
              <span aria-hidden="true" className="text-sm leading-none">↑</span>
            </button>
          ) : null}
          {canGoDown ? (
            <button
              type="button"
              aria-label="跳到对话底部"
              title="跳到最新消息"
              onClick={() => jump(scrollRef.current?.scrollHeight || 0)}
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/75 text-[var(--color-text-tertiary)] opacity-60 shadow-sm transition hover:opacity-95"
            >
              <span aria-hidden="true" className="text-sm leading-none">↓</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function CcMessageStream({ scope }: { scope: CcChatScope }) {
  const { chat, people, xhs, normalizedSearchQuery, shownActiveSearchMessageId,
    selectMode, selectedMessageIds, toggleSelectedMessage, startSelecting, setRecallDetail, copy,
    openSearchFromFloat } = scope
  const conversationMessages = chat.messages.filter(message => !message.handoff)
  const latestAssistantId = [...conversationMessages]
    .reverse()
    .find(message => message.role === 'assistant')?.id

  const firstMessageId = conversationMessages[0]?.id || ''
  const lastMessage = conversationMessages.at(-1)
  const lastMessageId = lastMessage?.id || ''
  const lastMessageVersion = lastMessage
    ? [
        lastMessage.id,
        lastMessage.text.length,
        lastMessage.thinking?.length || 0,
        lastMessage.process?.reduce(
          (length, event) => length + (event.type === 'thinking' || event.type === 'text' ? event.text.length : 0),
          0,
        ) || 0,
        lastMessage.tools?.length || 0,
        lastMessage.streaming ? 1 : 0,
      ].join(':')
    : ''
  return (
    <CcScrollJumps
      sessionId={chat.sessionId}
      firstMessageId={firstMessageId}
      lastMessageId={lastMessageId}
      lastMessageVersion={lastMessageVersion}
      pendingCount={chat.pending.length}
      layoutKey={selectMode ? 'select' : 'normal'}
      onOpenSearch={openSearchFromFloat}
    >
      <div className="mx-auto flex min-w-0 max-w-[var(--chat-assistant-width)] flex-col gap-7">
        {chat.handoffTranscript && !chat.isRolling ? (
          <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-4 py-3.5">
            <div className="mb-2 text-2xs font-medium text-[var(--color-text-disabled)]">
              换窗带入 · 最近对话
            </div>
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {chat.handoffTranscript}
            </div>
          </section>
        ) : null}
        {!chat.historyLoading && chat.messages.length > 0 && chat.hasEarlierHistory ? (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void chat.loadEarlierHistory()}
              disabled={chat.earlierHistoryLoading}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-60"
            >
              {chat.earlierHistoryLoading ? '正在加载…' : '加载更早消息'}
            </button>
          </div>
        ) : null}
        {chat.historyLoading ? (
          <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史</div>
        ) : conversationMessages.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-note font-medium text-[var(--color-text-heading)]">开始一段对话</div>
            <div className="mt-1.5 text-meta text-[var(--color-text-disabled)]">
              记忆会在你发言时自动注入，回复下方能看到召回了什么
            </div>
            <div className="mt-2 text-meta text-[var(--color-text-disabled)]">
              当前：{MODE_LABEL[chat.mode]}模式
            </div>
          </div>
        ) : (
          conversationMessages.map((m, index) => (
              <div key={m.renderKey || m.id}>
                {index === 0 || visibleChatDay(conversationMessages[index - 1]) !== visibleChatDay(m) ? (
                  <div id={`chat-day-${visibleChatDay(m)}`} className="mb-5 flex items-center gap-3 pt-2 text-2xs text-[var(--color-text-disabled)]">
                    <span className="h-px flex-1 bg-[var(--color-border-light)]" />
                    <span>{visibleChatDay(m)}</span>
                    <span className="h-px flex-1 bg-[var(--color-border-light)]" />
                  </div>
                ) : null}
                <CcMessageRow
                  message={m}
                  isCurrentTurn={m.id === latestAssistantId}
                  persona={
                    (m.personaId && people.personas.find(p => p.id === m.personaId)) || people.active
                  }
                  onCopy={copy}
                  onEditAndResend={m.fromHistory ? undefined : text => chat.setDraft(text)}
                  onOpenRecall={setRecallDetail}
                  onRetryPersistence={chat.retryPersistence}
                  onClearAttachment={chat.clearAttachment}
                  searchQuery={normalizedSearchQuery}
                  searchActive={m.id === shownActiveSearchMessageId}
                  selectMode={selectMode}
                  selected={selectedMessageIds.has(m.id)}
                  onToggleSelect={toggleSelectedMessage}
                  onStartSelect={startSelecting}
                />
                {m.role === 'user' && (() => {
                  const url = extractXhsUrl(m.text)
                  const card = url ? xhs.cardsByUrl.get(url) : undefined
                  return card ? (
                    <div className="mt-2 flex justify-end pr-1">
                      <CcXhsCard state={card} />
                    </div>
                  ) : null
                })()}
              </div>
            ),
          )
        )}
        {/* 等着点批准的操作。放在消息流最后 —— 那一轮正停在这里等，
            它就是「现在该看的东西」。刷新页面不会丢（队列在服务端）。 */}
        {chat.pending.map(req => (
          <CcPermCard key={req.id} request={req} onAnswer={chat.answerPermission} />
        ))}
        {chat.autoAllowEdits ? (
          <div className="cc-auto-allow">
            <span>这次对话里改文件不再一条条问了（跑命令仍然每次都问）</span>
            <button
              type="button"
              className="ml-auto shrink-0 underline"
              onClick={() => void chat.stopAutoAllow()}
            >
              改回每次都问
            </button>
          </div>
        ) : null}
        {chat.error ? (
          <div className="rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] px-3.5 py-2.5 text-xs text-[var(--color-danger)]">
            {chat.error}
          </div>
        ) : null}
        <div />
      </div>
    </CcScrollJumps>
  )
}
