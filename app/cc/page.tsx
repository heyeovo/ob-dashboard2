'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ccMessageVisibleText } from './CcMessageRow'
import { useXhsCard } from './useXhsCard'
import { requestedCcSessionId, useCcChat } from './useCcChat'
import { useIsRemote } from './useIsRemote'
import { usePersonas } from './usePersonas'
import type { CcMessage } from './types'
import type { CcPersona } from './persona'
import type { HistoricalConversation } from './historicalChats'
import { getCcChatMetrics } from './CcChatMetrics'
import CcChatView from './CcChatView'
import type { CcChatScope } from './CcChatScope'

// 第 4 步的聊天页。
//
// 引擎：cc（claude code Agent SDK 子进程），走 /api/cc-chat 的 SSE。
// 记忆：UserPromptSubmit hook → Haven /api/hook/recall（服务端做，前端只看结果）。
// 存储：每轮写回 Haven 的 conversation_turns，跟 Polaris 同一张表。
// 权限：第一版只读（Read / Grep / Glob）。写文件和跑命令等第 5 步的 diff 批准。

export default function CcChatPage() {
  const isRemote = useIsRemote()
  const people = usePersonas()
  const chat = useCcChat(people.activeId, isRemote)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  // 协作者：左上角开列表，右上角开设置。settingsFor 为 null 就是没开设置。
  const [personaRailOpen, setPersonaRailOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<CcPersona | null>(null)
  const [recallDetail, setRecallDetail] = useState<CcMessage | null>(null)
  const [winSetOpen, setWinSetOpen] = useState(false)
  const [historyDateOpen, setHistoryDateOpen] = useState(false)
  const [historyDate, setHistoryDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))
  const [handoffOpen, setHandoffOpen] = useState<{ fromSessionId: string | null } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchSessionId, setSearchSessionId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchMessageId, setActiveSearchMessageId] = useState('')
  const [activeHistorical, setActiveHistorical] = useState<HistoricalConversation | null>(null)
  const [forwardedBlock, setForwardedBlock] = useState<{ title: string; lines: string[] } | null>(null)
  const xhs = useXhsCard()
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const [cacheClock, setCacheClock] = useState(() => Date.now())
  const mobilePageRef = useRef<HTMLDivElement>(null)
  const mobileComposerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (mobileView !== 'chat' || activeHistorical) return
    const pageNode = mobilePageRef.current
    const headerNode = pageNode?.querySelector<HTMLElement>('.cc-topbar')
    const composerNode = mobileComposerRef.current
    if (!pageNode || !headerNode || !composerNode) return
    const updateHeight = () => {
      pageNode.style.setProperty('--cc-header-height', `${headerNode.getBoundingClientRect().height}px`)
      pageNode.style.setProperty('--cc-composer-height', `${composerNode.getBoundingClientRect().height}px`)
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(headerNode)
    observer.observe(composerNode)
    return () => observer.disconnect()
  }, [mobileView, activeHistorical])

  useEffect(() => {
    const timer = window.setInterval(() => setCacheClock(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      if (requestedCcSessionId(window.location.search)) setMobileView('chat')
    }, 0)
    const showList = () => {
      setMobileView('list')
      setActiveHistorical(null)
      setSelectMode(false)
      setSelectedMessageIds(new Set())
    }
    window.addEventListener('cc:show-list', showList)
    return () => {
      window.clearTimeout(initialTimer)
      window.removeEventListener('cc:show-list', showList)
    }
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

  const metrics = getCcChatMetrics(chat, people, cacheClock)

  const openSearchFromFloat = useCallback(() => {
    setSearchSessionId(chat.sessionId)
    setSearchQuery('')
    setActiveSearchMessageId('')
    setSearchOpen(true)
  }, [chat.sessionId])

  const scope: CcChatScope = {
    chat, people, xhs, metrics, mobileView, setMobileView, mobilePageRef,
    mobileComposerRef, personaRailOpen, setPersonaRailOpen, settingsFor,
    setSettingsFor, recallDetail, setRecallDetail, winSetOpen, setWinSetOpen,
    historyDateOpen, setHistoryDateOpen, historyDate, setHistoryDate,
    handoffOpen, setHandoffOpen, searchOpen, setSearchOpen, searchSessionId,
    setSearchSessionId, searchQuery, setSearchQuery, activeSearchMessageId,
    setActiveSearchMessageId, activeHistorical, setActiveHistorical,
    forwardedBlock, setForwardedBlock, selectMode, setSelectMode,
    selectedMessageIds, setSelectedMessageIds, pendingForward, setPendingForward,
    searchVisible, normalizedSearchQuery, searchResults, shownActiveSearchMessageId,
    activeSearchIndex, startSelecting, stopSelecting, toggleSelectedMessage,
    forwardSelectedMessages, confirmForwardTo, moveSearch, closeSearch, copy,
    openSearchFromFloat,
  }

  return <CcChatView scope={scope} />
}
