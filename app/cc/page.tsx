'use client'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import CcComposer from './CcComposer'
import CcMessageRow, { ccMessageVisibleText } from './CcMessageRow'
import { CcPermCard } from './CcPermCard'
import CcPersonaDialog from './CcPersonaDialog'
import CcPersonaRail from './CcPersonaRail'
import CcRecallDialog from './CcRecallDialog'
import CcSessionRail from './CcSessionRail'
import { draftPersona, type CcPersona } from './persona'
import { useCcChat } from './useCcChat'
import { useIsRemote } from './useIsRemote'
import { usePersonas } from './usePersonas'
import type { CcMessage } from './types'
import CcWindowSettings from './CcWindowSettings'
import CcHandoffDialog from './CcHandoffDialog'
import CcHistoricalChat from './CcHistoricalChat'
import { historicalKey, type HistoricalConversation } from './historicalChats'
import { MODE_LABEL } from '@/app/lib/ccModes'
import { modelLabel, modelsFor } from './upstream'
import { requiresImportedSessionHandoff } from './engineRouting'

// 第 4 步的聊天页。
//
// 引擎：cc（claude code Agent SDK 子进程），走 /api/cc-chat 的 SSE。
// 记忆：UserPromptSubmit hook → Haven /api/hook/recall（服务端做，前端只看结果）。
// 存储：每轮写回 Haven 的 conversation_turns，跟 Polaris 同一张表。
// 权限：第一版只读（Read / Grep / Glob）。写文件和跑命令等第 5 步的 diff 批准。

function formatCost(usd: number) {
  if (!usd) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatCacheLeft(ms: number) {
  if (ms <= 0) return null
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60 ? `${sec % 60}s` : ''}`
}

/** 「23.4k / 1M」。上下文用量胶囊用。 */
function formatTokens(n: number) {
  if (n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

function CcScrollJumps({
  children,
  sessionId,
  firstMessageId,
  lastMessageId,
  lastMessageVersion,
  pendingCount,
  onOpenSearch,
}: {
  children: ReactNode
  sessionId: string
  firstMessageId: string
  lastMessageId: string
  lastMessageVersion: string
  pendingCount: number
  onOpenSearch?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null)
  const scrollTopRef = useRef(0)
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
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={update}
        className="no-scrollbar h-full overflow-y-auto px-4 py-6"
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
        <div className="pointer-events-none absolute bottom-3 right-4 z-20 flex flex-col gap-1.5">
          {onOpenSearch ? (
            <button
              type="button"
              aria-label="搜索当前对话"
              title="搜索当前对话"
              onClick={onOpenSearch}
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/75 text-[var(--color-text-tertiary)] opacity-60 shadow-sm backdrop-blur-sm transition hover:opacity-95 md:hidden"
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
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/75 text-[var(--color-text-tertiary)] opacity-60 shadow-sm backdrop-blur-sm transition hover:opacity-95"
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
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/75 text-[var(--color-text-tertiary)] opacity-60 shadow-sm backdrop-blur-sm transition hover:opacity-95"
            >
              <span aria-hidden="true" className="text-sm leading-none">↓</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function CcChatPage() {
  const isRemote = useIsRemote()
  const people = usePersonas()
  const chat = useCcChat(people.activeId, isRemote)
  const [railOpen, setRailOpen] = useState(false)
  // 协作者：左上角开列表，右上角开设置。settingsFor 为 null 就是没开设置。
  const [personaRailOpen, setPersonaRailOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<CcPersona | null>(null)
  const [recallDetail, setRecallDetail] = useState<CcMessage | null>(null)
  const [winSetOpen, setWinSetOpen] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState<{ fromSessionId: string | null } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchSessionId, setSearchSessionId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchMessageId, setActiveSearchMessageId] = useState('')
  const [activeHistorical, setActiveHistorical] = useState<HistoricalConversation | null>(null)
  const [forwardedBlock, setForwardedBlock] = useState<{ title: string; lines: string[] } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const [cacheClock, setCacheClock] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setCacheClock(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const startSelecting = (messageId?: string) => {
    setSelectMode(true)
    setSelectedMessageIds(messageId ? new Set([messageId]) : new Set())
  }

  const stopSelecting = () => {
    setSelectMode(false)
    setSelectedMessageIds(new Set())
  }

  const toggleSelectedMessage = (messageId: string) => {
    setSelectedMessageIds(current => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  const [pendingForward, setPendingForward] = useState<{ title: string; lines: string[] } | null>(null)

  const forwardSelectedMessages = () => {
    const lines = chat.messages.flatMap(message => {
      if (!selectedMessageIds.has(message.id)) return []
      const text = ccMessageVisibleText(message).trim()
      if (!text) return []
      const messagePersona = message.personaId
        ? people.personas.find(persona => persona.id === message.personaId)
        : undefined
      const speaker = message.role === 'user'
        ? '小羊'
        : messagePersona?.name || people.active.name
      return [`[${new Date(message.createdAt).toLocaleString('zh-CN')}] ${speaker}: ${text}`]
    })
    if (lines.length === 0) return
    setPendingForward({ title: chat.sessionTitle || '当前聊天', lines })
  }

  const confirmForwardTo = (targetSessionId: string) => {
    if (!pendingForward) return
    if (targetSessionId !== chat.sessionId) {
      void chat.switchSession(targetSessionId)
    }
    setForwardedBlock(pendingForward)
    setPendingForward(null)
    stopSelecting()
  }

  const searchVisible = searchOpen && searchSessionId === chat.sessionId
  const normalizedSearchQuery = searchVisible ? searchQuery.trim().toLocaleLowerCase() : ''
  const searchResults = useMemo(
    () => normalizedSearchQuery
      ? chat.messages.filter(message =>
          !message.handoff && message.text.toLocaleLowerCase().includes(normalizedSearchQuery),
        )
      : [],
    [chat.messages, normalizedSearchQuery],
  )
  const shownActiveSearchMessageId = searchResults.some(message => message.id === activeSearchMessageId)
    ? activeSearchMessageId
    : searchResults[0]?.id || ''
  const activeSearchIndex = searchResults.findIndex(message => message.id === shownActiveSearchMessageId)

  useEffect(() => {
    if (!searchVisible) return
    const frame = window.requestAnimationFrame(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-cc-search-input]'))
      inputs.find(input => input.getClientRects().length > 0)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [searchVisible])

  useEffect(() => {
    if (!shownActiveSearchMessageId) return
    const frame = window.requestAnimationFrame(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
      rows
        .find(row => row.dataset.messageId === shownActiveSearchMessageId && row.getClientRects().length > 0)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [shownActiveSearchMessageId])

  const moveSearch = (direction: -1 | 1) => {
    if (searchResults.length === 0) return
    const current = activeSearchIndex >= 0 ? activeSearchIndex : 0
    const next = (current + direction + searchResults.length) % searchResults.length
    setActiveSearchMessageId(searchResults[next].id)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setActiveSearchMessageId('')
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
  }

  // 顶部显示实际在跑的那个模型（stats.model 来自服务端）；进程没起来就显示这一窗选的
  const modelCandidates = modelsFor(chat.upstream, chat.pick.kind, chat.pick.providerId)
  const shownModel = modelLabel(
    chat.latestTurn?.model || chat.stats.model || chat.pick.model,
    modelCandidates,
  )
  const shownProvider = chat.latestTurn?.providerLabel
    || chat.stats.boot?.providerLabel
    || (chat.effectiveEngine === 'cc' && chat.pick.kind === 'subscription' ? 'Claude 订阅' : '')
  const currentLaneId = chat.pick.kind === 'subscription'
    ? 'subscription'
    : `api:${chat.pick.providerId || 'default'}`
  const latestLaneTurn = [...chat.messages].reverse().find(message =>
    message.role === 'assistant' && message.engine !== 'selfhost' && message.laneId === currentLaneId,
  )
  const contextSnapshot = chat.stats.contextSnapshot || latestLaneTurn?.contextSnapshot || null
  const ctxTokens = contextSnapshot?.totalTokens
    || latestLaneTurn?.context?.inputTokensEstimated
    || chat.stats.contextTokens
  const ctxMax = contextSnapshot?.maxTokens
    || latestLaneTurn?.context?.modelContextLimit
    || chat.stats.contextMaxTokens
  const cacheSnapshot = chat.stats.live
    ? chat.stats.cacheRefreshedAt
      ? {
          refreshedAt: chat.stats.cacheRefreshedAt,
          systemTtlMs: 60 * 60 * 1000,
          sessionTtlMs: 5 * 60 * 1000,
        }
      : null
    : latestLaneTurn?.cacheSnapshot || null
  const cacheAge = cacheSnapshot ? Math.max(0, cacheClock - cacheSnapshot.refreshedAt) : 0
  const cacheSystemRemainingMs = cacheSnapshot
    ? Math.max(0, cacheSnapshot.systemTtlMs - cacheAge)
    : 0
  const cacheSessionRemainingMs = cacheSnapshot
    ? Math.max(0, cacheSnapshot.sessionTtlMs - cacheAge)
    : 0
  const cacheSystem = formatCacheLeft(cacheSystemRemainingMs)
  const cacheSession = formatCacheLeft(cacheSessionRemainingMs)
  const cacheLabel = !cacheSnapshot
    ? '缓存待确认'
    : cacheSystem
      ? `缓存 ${cacheSystem}${cacheSession ? ` / 会话 ${cacheSession}` : ' / 会话已过期'}`
      : '缓存已过期'
  const laneCompactions = chat.messages.flatMap(message => {
    if (message.laneId !== currentLaneId) return []
    const standalone = message.compaction ? [message.compaction] : []
    const inline = (message.process || []).flatMap(event => event.type === 'compact' ? [event.compaction] : [])
    return [...standalone, ...inline]
  })
  const allCompactions = [
    ...laneCompactions,
    ...(chat.stats.lastCompaction ? [chat.stats.lastCompaction] : []),
  ]
  const latestCompaction = allCompactions.sort((a, b) => a.at - b.at).at(-1) || null
  const compactionCount = new Set(allCompactions.map(item => item.id)).size
  const displayStats = {
    ...chat.stats,
    contextSnapshot,
    contextTokens: ctxTokens,
    contextMaxTokens: ctxMax,
    cacheRefreshedAt: cacheSnapshot?.refreshedAt || 0,
    cacheRemainingMs: cacheSessionRemainingMs,
    cacheSystemRemainingMs,
    lastCompaction: latestCompaction,
    compactionCount: Math.max(chat.stats.compactionCount, compactionCount),
  }
  const totalChars = chat.messages.reduce((n, m) => n + m.text.length, 0)

  const header = (
    <div className="cc-topbar flex items-center gap-2 px-3 py-2.5 md:gap-3 md:px-4">
      {selectMode ? (
        <div className="flex min-w-0 flex-1 items-center justify-between md:hidden">
          <button type="button" onClick={stopSelecting} className="rounded-full px-2 py-1 text-xs text-[var(--color-text-secondary)]">
            取消
          </button>
          <span className="text-xs font-medium text-[var(--color-text-primary)]">已选 {selectedMessageIds.size} 条</span>
          <span className="w-10" aria-hidden="true" />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setRailOpen(true)}
        className={`${selectMode ? 'hidden' : ''} rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] md:hidden`}
      >
        对话
      </button>
      {/* 左：当前协作者，点开换人 */}
      <button
        type="button"
        onClick={() => setPersonaRailOpen(true)}
        className={`${selectMode ? 'hidden md:flex' : ''} cc-persona-chip`}
        title="切换协作者"
      >
        <span className="cc-avatar" style={{ background: people.active.tint }} aria-hidden="true">
          {people.active.initial}
        </span>
        {/* 手机上只留头像，名字省掉 —— 顶栏横向就那么点地方 */}
        <span className="hidden max-w-[7rem] truncate md:inline">{people.active.name}</span>
      </button>
      <div className={`${selectMode ? 'hidden md:block' : ''} min-w-0 flex-1`}>
        <button
          type="button"
          title="点击修改窗口标题"
          onClick={() => {
            const title = window.prompt('修改窗口标题', chat.sessionTitle === '新对话' ? '' : chat.sessionTitle)
            if (title?.trim()) void chat.renameSession(chat.sessionId, title)
          }}
          className="block max-w-full truncate text-left text-[13px] font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
        >
          {chat.sessionTitle}
        </button>
        <div className="mt-0.5 whitespace-nowrap text-[11px] text-[var(--color-text-disabled)] md:hidden">
          {chat.effectiveEngine === 'selfhost' ? '纯聊天' : `${MODE_LABEL[chat.mode]}模式`}
        </div>
        {/* 完整运行信息只在桌面显示；手机去「本窗」查看，避免顶栏拥挤。 */}
        <div className="mt-0.5 hidden items-center gap-x-2 overflow-hidden whitespace-nowrap text-[11px] text-[var(--color-text-disabled)] md:flex">
          <span>{chat.effectiveEngine === 'selfhost' ? '纯聊天' : `${MODE_LABEL[chat.mode]}模式`}</span>
          <span>·</span>
          <span>{chat.latestTurn?.engine === 'selfhost' || (!chat.latestTurn && chat.effectiveEngine === 'selfhost') ? '自建引擎' : 'cc'}</span>
          {shownProvider ? <><span>·</span><span>{shownProvider}</span></> : null}
          {shownModel ? (
            <>
              <span>·</span>
              <span className="max-w-[11rem] truncate" title={shownModel}>
                {shownModel}
              </span>
            </>
          ) : null}
          <span>·</span>
          <span>{chat.stats.turnCount} 轮</span>
          {chat.effectiveEngine === 'cc' ? (
            <>
              <span>·</span>
              <span title={contextSnapshot ? '最近一次真实模型请求确认的当前窗口 Context' : '下一次真实模型调用后确认'}>
                {chat.stats.compacting
                  ? 'Context 压缩中'
                  : ctxTokens > 0
                    ? `${formatTokens(ctxTokens)}${ctxMax > 0 ? ` / ${formatTokens(ctxMax)}` : ''}`
                    : 'Context 待确认'}
              </span>
            </>
          ) : null}
          {/* 花费只在这个进程还活着时显示。读回来的历史算不出钱 ——
              不同中转站、不同模型价格不一样，要一张价格表，见 HANDOFF 待办。
              这时候显示 $0 是在骗人，不如不显示。 */}
          {chat.stats.totalCostUsd > 0 && chat.pick.kind !== 'subscription' ? (
            <>
              <span>·</span>
              <span>{formatCost(chat.stats.totalCostUsd)}</span>
            </>
          ) : null}
          {chat.effectiveEngine === 'cc' ? (
            <>
              <span>·</span>
              <span
                title="Anthropic prompt cache 两档：系统提示 + 工具说明进 1 小时档，会话消息进 5 分钟档。5 分钟过了不等于缓存全没，接着聊仍然便宜。"
              >
                {cacheLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {/* 右：本窗口设置（这一个对话的模型/供应商）+ 协作者设置（跨对话的人设） */}
      <div className={`${selectMode ? 'hidden md:flex' : 'flex'} shrink-0 items-center gap-1 md:gap-2`}>
        <button
          type="button"
          onClick={() => selectMode ? stopSelecting() : startSelecting()}
          className="hidden rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10px] text-[var(--color-text-tertiary)] md:inline-flex"
        >
          {selectMode ? '取消选择' : '选择'}
        </button>
        <button
          type="button"
          onClick={() => selectMode ? stopSelecting() : startSelecting()}
          aria-label={selectMode ? '取消选择' : '选择消息'}
          title={selectMode ? '取消选择' : '选择消息'}
          className="cc-icon-btn md:hidden"
        >
          {selectMode ? (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setSearchSessionId(chat.sessionId)
            setSearchQuery('')
            setActiveSearchMessageId('')
            setSearchOpen(true)
          }}
          aria-label="搜索当前对话"
          title="搜索当前对话"
          className="cc-icon-btn hidden md:flex"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.3" />
            <path d="m15.5 15.5 4 4" />
          </svg>
        </button>
        <div className="flex rounded-full border border-[var(--color-border)] bg-white p-0.5 text-[10px]">
          {(['cc', 'selfhost'] as const).map(engine => (
            <button
              key={engine}
              type="button"
              disabled={chat.isRemote === true || chat.engineSaving || chat.sending}
              onClick={() => {
                const shouldChooseMode =
                  engine === 'cc' && chat.effectiveEngine === 'selfhost' && !chat.modeLocked
                void chat.changeEngine(engine)
                if (shouldChooseMode) setWinSetOpen(true)
              }}
              className={`rounded-full px-2 py-1 ${chat.effectiveEngine === engine ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'} disabled:cursor-not-allowed disabled:opacity-55`}
              title={chat.isRemote === true ? 'Vercel 环境仅支持自建引擎，本地首选不会被覆盖' : `切换到 ${engine === 'cc' ? 'cc' : '自建引擎'}`}
            >
              {engine === 'cc' ? 'cc' : '自建'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWinSetOpen(true)}
          aria-label="本窗口设置"
          title="本窗口设置：模型 / 力度 / 供应商"
          className="cc-icon-btn"
        >
          本窗
        </button>
        <button
          type="button"
          onClick={() => setSettingsFor(people.active)}
          aria-label="协作者设置"
          title="协作者设置"
          className="cc-icon-btn"
        >
          设置
        </button>
      </div>
    </div>
  )

  const latestAssistantId = [...chat.messages]
    .reverse()
    .find(message => message.role === 'assistant' && !message.handoff)?.id

  const firstMessageId = chat.messages[0]?.id || ''
  const lastMessage = chat.messages.at(-1)
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

  const openSearchFromFloat = useCallback(() => {
    setSearchSessionId(chat.sessionId)
    setSearchQuery('')
    setActiveSearchMessageId('')
    setSearchOpen(true)
  }, [chat.sessionId])

  const thread = () => (
    <CcScrollJumps
      sessionId={chat.sessionId}
      firstMessageId={firstMessageId}
      lastMessageId={lastMessageId}
      lastMessageVersion={lastMessageVersion}
      pendingCount={chat.pending.length}
      onOpenSearch={openSearchFromFloat}
    >
      <div className="mx-auto flex max-w-[var(--chat-assistant-width)] flex-col gap-7">
        {!chat.historyLoading && chat.messages.length > 0 && chat.hasEarlierHistory ? (
          <div className="text-center">
            <button
              type="button"
              onClick={() => void chat.loadEarlierHistory()}
              disabled={chat.earlierHistoryLoading}
              className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-60"
            >
              {chat.earlierHistoryLoading ? '正在加载…' : '加载更早消息'}
            </button>
          </div>
        ) : null}
        {chat.historyLoading ? (
          <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史</div>
        ) : chat.messages.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-[13.5px] font-medium text-[var(--color-text-heading)]">开始一段对话</div>
            <div className="mt-1.5 text-[11.5px] text-[var(--color-text-disabled)]">
              记忆会在你发言时自动注入，回复下方能看到召回了什么
            </div>
            <div className="mt-2 text-[11px] text-[var(--color-text-disabled)]">
              当前：{MODE_LABEL[chat.mode]}模式
            </div>
          </div>
        ) : (
          chat.messages.map(m =>
            m.handoff ? (
              // 换窗带过来的上一窗原文：淡色、只作衔接语境，不走消息气泡
              <div key={m.id} className="opacity-55">
                <div className="mb-0.5 text-[10.5px] font-mono text-[var(--color-text-disabled)]">
                  role: {m.role}
                </div>
                <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
                  {m.text}
                </div>
              </div>
            ) : (
              <CcMessageRow
                key={`${m.id}:${m.id === latestAssistantId ? 'current' : 'history'}`}
                message={m}
                isCurrentTurn={m.id === latestAssistantId}
                // 按那一轮记下的人画头像名字；老消息没记就用当前选中的
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
              />
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

  const composer = (
    <div className="px-4 pb-4 pt-1">
      <div className="mx-auto max-w-[var(--chat-assistant-width)]">
        {selectMode ? (
          <div className="flex items-center justify-between rounded-2xl border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-4 py-2.5 shadow-sm">
            <span className="text-xs text-[var(--color-primary)]">
              {selectedMessageIds.size > 0 ? `已选 ${selectedMessageIds.size} 条消息` : '请选择消息'}
            </span>
            <button
              type="button"
              disabled={selectedMessageIds.size === 0}
              onClick={forwardSelectedMessages}
              className="rounded-full bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              转发所选消息
            </button>
          </div>
        ) : (
          <>
        {searchVisible ? (
          <div className="mb-2">
            <div className="flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-white px-2 py-1.5 shadow-sm">
              <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.3" />
                <path d="m15.5 15.5 4 4" />
              </svg>
              <input
                data-cc-search-input
                type="search"
                value={searchQuery}
                onChange={event => {
                  setSearchQuery(event.target.value)
                  setActiveSearchMessageId('')
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  moveSearch(event.shiftKey ? -1 : 1)
                }}
                placeholder="搜索当前对话"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
              />
              <div className="flex shrink-0 items-center rounded-full bg-[var(--color-surface-secondary)] p-0.5">
                <button
                  type="button"
                  onClick={() => moveSearch(-1)}
                  disabled={searchResults.length === 0}
                  aria-label="上一个匹配结果"
                  className="flex size-7 items-center justify-center rounded-full text-xs text-[var(--color-text-secondary)] disabled:opacity-30"
                >↑</button>
                <span className="min-w-10 px-1 text-center text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                  {searchResults.length > 0 ? `${Math.max(activeSearchIndex, 0) + 1}/${searchResults.length}` : '0/0'}
                </span>
                <button
                  type="button"
                  onClick={() => moveSearch(1)}
                  disabled={searchResults.length === 0}
                  aria-label="下一个匹配结果"
                  className="flex size-7 items-center justify-center rounded-full text-xs text-[var(--color-text-secondary)] disabled:opacity-30"
                >↓</button>
              </div>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="关闭搜索"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-base text-[var(--color-text-tertiary)]"
              >×</button>
            </div>
            {normalizedSearchQuery && chat.hasEarlierHistory ? (
              <button
                type="button"
                onClick={() => void chat.loadEarlierHistory()}
                disabled={chat.earlierHistoryLoading}
                className="mt-1.5 w-full text-center text-[11px] text-[var(--color-primary)] disabled:opacity-50"
              >
                {chat.earlierHistoryLoading ? '正在搜索更早消息…' : '继续搜索更早消息'}
              </button>
            ) : null}
          </div>
        ) : null}
        {chat.isRemote === true ? (
          <div className="mb-2 rounded-xl bg-[var(--color-primary-soft)] px-3 py-2 text-[11px] text-[var(--color-primary)]">
            Vercel 环境仅支持自建引擎；你的本地引擎首选没有被修改。
          </div>
        ) : null}
        {requiresImportedSessionHandoff(chat.activeSessionSource, chat.effectiveEngine) ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-text-secondary)] shadow-sm">
            <div>Claude Code 无法直接接回原来的 Polaris 运行会话；可切到自建引擎原窗续聊，或换窗启动新的 cc 会话。</div>
            <button
              type="button"
              onClick={() => setHandoffOpen({ fromSessionId: chat.sessionId })}
              className="mt-2 rounded-full bg-[var(--color-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]"
            >
              从这里换窗继续
            </button>
          </div>
        ) : (
          <CcComposer
            key={chat.sessionId}
            sessionId={chat.sessionId}
            value={chat.draft}
            onChange={chat.setDraft}
            onSubmit={attachments => {
              const prefix = forwardedBlock
                ? `<转发的消息 来源="${forwardedBlock.title}">\n${forwardedBlock.lines.join('\n---\n')}\n</转发的消息>\n\n`
                : ''
              chat.send(prefix + chat.draft, undefined, attachments)
              setForwardedBlock(null)
            }}
            onStop={chat.stop}
            onClearKind={chat.clearAttachmentsByKind}
            activeImageCount={chat.activeImageCount}
            activeFileCount={chat.activeFileCount}
            promptModules={people.active.promptModules}
            promptModuleOverrides={chat.promptModuleOverrides}
            promptModulesSaving={chat.promptModulesSaving}
            onPromptModuleToggle={chat.setPromptModuleEnabled}
            onError={chat.setError}
            sending={chat.sending}
            forwardedBlock={forwardedBlock}
            onClearForward={() => setForwardedBlock(null)}
          />
        )}
          </>
        )}
      </div>
    </div>
  )

  const rail = (
    <CcSessionRail
      sessions={chat.sessions}
      deletedSessions={chat.deletedSessions}
      activeSessionId={activeHistorical ? '' : chat.sessionId}
      activeHistoricalKey={activeHistorical ? historicalKey(activeHistorical) : ''}
      loading={chat.sessionsLoading}
      onPick={id => {
        setRailOpen(false)
        setActiveHistorical(null)
        stopSelecting()
        void chat.switchSession(id)
      }}
      onPickHistorical={conversation => {
        setRailOpen(false)
        setActiveHistorical(conversation)
        stopSelecting()
        closeSearch()
      }}
      onNew={() => {
        setRailOpen(false)
        setActiveHistorical(null)
        stopSelecting()
        setHandoffOpen({ fromSessionId: null })
      }}
      onRename={chat.renameSession}
      onDelete={chat.deleteSession}
      onPermanentDelete={chat.permanentlyDeleteSession}
    />
  )

  // 协作者列表：桌面端和手机端都是从左侧盖上来的浮层。
  // 桌面端左边那栏是会话列表，两个东西不能抢同一个位置。
  const personaRail = personaRailOpen ? (
    <div className="cc-mobile-overlay-clearance fixed inset-x-0 top-0 z-40 md:inset-0">
      <button
        type="button"
        aria-label="关闭协作者列表"
        onClick={() => setPersonaRailOpen(false)}
        className="absolute inset-0 bg-black/20"
      />
      <div className="absolute left-0 top-0 h-full w-[78%] max-w-[300px] bg-[var(--color-surface)] shadow-xl">
        <CcPersonaRail
          personas={people.personas}
          activeId={people.activeId}
          loading={people.loading}
          onPick={id => {
            setPersonaRailOpen(false)
            if (id === people.activeId) return
            people.selectPersona(id)
            // 换人 = 换一整套对话。开着的那个属于上一个协作者，留在屏幕上会串，
            // 直接开一个新的空对话。
            chat.startNewSession()
          }}
          onNew={() => {
            setPersonaRailOpen(false)
            setSettingsFor(draftPersona())
          }}
          onClose={() => setPersonaRailOpen(false)}
        />
      </div>
    </div>
  ) : null

  return (
    <>
      {/* 桌面端：左会话列表 + 右对话（导航是全局左侧竖栏，这一页不带顶部横条） */}
      <div className="cc-page hidden h-screen flex-col md:flex">
        <div className="flex min-h-0 flex-1">
          <aside className="cc-rail-pane w-[var(--chat-rail-width)] shrink-0">{rail}</aside>
          <main className="flex min-w-0 flex-1 flex-col">
            {activeHistorical ? (
              <CcHistoricalChat
                key={historicalKey(activeHistorical)}
                conversation={activeHistorical}
                persona={people.active}
                onOpenRail={() => setRailOpen(true)}
                onForward={block => { setForwardedBlock(block); setActiveHistorical(null) }}
              />
            ) : (
              <>
                {header}
                {thread()}
                {composer}
              </>
            )}
          </main>
        </div>
      </div>

      {/* 手机端：全屏对话，会话列表从左侧滑入 */}
      <div
        className="cc-page flex flex-col md:hidden"
        style={{ height: 'calc(100dvh - 76px - env(safe-area-inset-bottom, 0px))' }}
      >
        {activeHistorical ? (
          <CcHistoricalChat
            key={historicalKey(activeHistorical)}
            conversation={activeHistorical}
            persona={people.active}
            onOpenRail={() => setRailOpen(true)}
            onForward={block => { setForwardedBlock(block); setActiveHistorical(null) }}
          />
        ) : (
          <>
            {header}
            {thread()}
            {composer}
          </>
        )}
      </div>

      {railOpen ? (
        <div className="cc-mobile-overlay-clearance fixed inset-x-0 top-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="关闭对话列表"
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 bg-black/20"
          />
          <div className="absolute left-0 top-0 h-full w-[78%] max-w-[300px] bg-[var(--color-surface)] shadow-xl">
            {rail}
          </div>
        </div>
      ) : null}

      {personaRail}

      {settingsFor ? (
        <CcPersonaDialog
          // key = 换人就整个重挂，弹窗内部的草稿跟着重取
          key={settingsFor.id}
          persona={settingsFor}
          canDelete={people.personas.length > 1 && people.personas.some(p => p.id === settingsFor.id)}
          saving={people.saving}
          onSave={async persona => {
            const res = await people.savePersona(persona)
            // 新建的：保存成功就切过去
            if (res.ok && res.persona) {
              people.selectPersona(res.persona.id)
              setSettingsFor(res.persona)
            }
            return { ok: res.ok }
          }}
          onDelete={people.deletePersona}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}

      {people.error ? (
        <div className="cc-persona-error">{people.error}</div>
      ) : null}

      {/* 本窗口设置：只管这一个对话。模型/力度/思考当场生效，供应商要新建对话 */}
      {winSetOpen ? (
        <CcWindowSettings
          sessionId={chat.sessionId}
          stats={displayStats}
          totalChars={totalChars}
          activeProvider={shownProvider}
          activeModel={shownModel}
          contextTokens={ctxTokens}
          contextMaxTokens={ctxMax}
          upstream={chat.upstream}
          pick={chat.pick}
          proUsage={chat.proUsage}
          onRefreshProUsage={() => void chat.refreshProUsage()}
          onPick={next => void chat.applyPick(next)}
          web={chat.webSettings}
          onWebChange={chat.applyWebSettings}
          onSaveWebDefaults={() => void chat.saveWebDefaults()}
          webSaving={chat.webSaving}
          engine={chat.effectiveEngine}
          mode={chat.mode}
          onModeChange={chat.setMode}
          modeLocked={chat.modeLocked}
          providerLocked={chat.providerLocked}
          webLocked={chat.modeLocked}
          note={chat.settingsNote}
          onCompact={chat.compactNow}
          onHandoff={() => {
            setWinSetOpen(false)
            setHandoffOpen({ fromSessionId: chat.sessionId })
          }}
          onClose={() => {
            setWinSetOpen(false)
            chat.setSettingsNote('')
          }}
        />
      ) : null}

      {/* 换窗 / 新对话弹窗 */}
      {handoffOpen ? (
        <CcHandoffDialog
          fromSessionId={handoffOpen.fromSessionId}
          currentMode={chat.mode}
          personaId={people.active.id}
          onConfirm={payload => {
            setHandoffOpen(null)
            chat.startWithHandoff(payload)
          }}
          onClose={() => setHandoffOpen(null)}
        />
      ) : null}

      {/* 召回详情：按模块分段。⚠️ 各模块的正文服务端还没回传（见组件内注释） */}
      {recallDetail ? (
        <CcRecallDialog message={recallDetail} onClose={() => setRecallDetail(null)} />
      ) : null}

      {/* 转发目标选择 */}
      {pendingForward ? (
        <div className="cc-modal-scrim fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="取消转发"
            onClick={() => { setPendingForward(null); stopSelecting() }}
            className="absolute inset-0"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="选择转发目标"
            className="cc-modal cc-tool-sheet relative flex max-h-[70vh] w-full max-w-md flex-col"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/10 sm:hidden" />
            <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-5 py-4">
              <h2 className="text-[15px] font-semibold text-[var(--color-text-heading)]">
                转发到…
              </h2>
              <button
                type="button"
                onClick={() => { setPendingForward(null); stopSelecting() }}
                className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              >
                取消
              </button>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1">
                {chat.sessions
                  .filter(s => !s.deleted_at)
                  .map(s => (
                    <button
                      key={s.session_id}
                      type="button"
                      onClick={() => confirmForwardTo(s.session_id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-secondary)] ${s.session_id === chat.sessionId ? 'bg-[var(--color-primary-soft)]' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                          {s.title || '新对话'}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">
                          {s.turn_count} 轮
                          {s.session_id === chat.sessionId ? ' · 当前窗口' : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm text-[var(--color-text-tertiary)]" aria-hidden="true">›</span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="border-t border-[var(--color-border-light)] px-5 py-3 text-center text-[10px] text-[var(--color-text-disabled)]">
              已选 {pendingForward.lines.length} 条消息
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
