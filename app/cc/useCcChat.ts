'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CcMessage, CcSessionListItem, CcSessionStats, CcToolEvent } from './types'
import { EMPTY_STATS } from './types'

// /cc 聊天页的状态与 SSE 消费。UI 组件不碰 fetch，全在这里。
//
// ⚠️ session_id 的角色：前端生成、贯穿全程。它同时是
//   · hook 送去 Haven 召回的分组键
//   · 写回 conversation_turns 的分组键
//   · 会话列表里认的那个 id
// claude code 自己的 session id 在服务端另存（做 resume 用），前端不管。

const NEW_SESSION_PREFIX = 'ob2-'

function newSessionId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 8)
  return `${NEW_SESSION_PREFIX}${stamp}-${rand}`
}

function localId() {
  return `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`
}

/** Haven 的一轮（user + assistant 一行）拆成界面上的两条消息。 */
type HavenTurnRow = {
  id: number
  user_text: string
  assistant_text: string
  created_at: string
  source: string
}

function turnsToMessages(turns: HavenTurnRow[]): CcMessage[] {
  const out: CcMessage[] = []
  for (const t of turns) {
    const at = Date.parse(t.created_at) || Date.now()
    if (t.user_text?.trim()) {
      out.push({ id: `h${t.id}u`, role: 'user', text: t.user_text, createdAt: at, fromHistory: true })
    }
    if (t.assistant_text?.trim()) {
      out.push({
        id: `h${t.id}a`,
        role: 'assistant',
        text: t.assistant_text,
        createdAt: at,
        fromHistory: true,
      })
    }
  }
  return out
}

export function useCcChat() {
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState<CcSessionListItem[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [messages, setMessages] = useState<CcMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stats, setStats] = useState<CcSessionStats>(EMPTY_STATS)
  const [error, setError] = useState('')

  // 草稿分会话保存（切走再回来还在），跟 Polaris 一样
  const draftsRef = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  // 首次进页面：开一个新会话 id + 拉会话列表
  useEffect(() => {
    setSessionId(newSessionId())
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/cc-turns?limit=60', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok && Array.isArray(data.sessions)) setSessions(data.sessions)
    } catch {
      /* 会话列表拉不到不影响聊天 */
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  // 顶部的费用 / 缓存剩余时间：每 20 秒问一次服务端
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/cc-chat?session_id=${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
        })
        const data = await res.json()
        if (!cancelled && data.ok) setStats(data.stats as CcSessionStats)
      } catch {
        /* 忽略 */
      }
    }
    void tick()
    const timer = setInterval(tick, 20_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId])

  const switchSession = useCallback(
    async (nextId: string) => {
      if (nextId === sessionId) return
      // 存草稿
      draftsRef.current.set(sessionId, draft)
      abortRef.current?.abort()
      setSending(false)
      setSessionId(nextId)
      setDraft(draftsRef.current.get(nextId) || '')
      setError('')
      setMessages([])
      setStats(EMPTY_STATS)

      setHistoryLoading(true)
      try {
        const res = await fetch(`/api/cc-turns?session_id=${encodeURIComponent(nextId)}&limit=200`, {
          cache: 'no-store',
        })
        const data = await res.json()
        if (data.ok && Array.isArray(data.turns)) {
          setMessages(turnsToMessages(data.turns as HavenTurnRow[]))
        }
      } catch {
        setError('历史消息读取失败')
      } finally {
        setHistoryLoading(false)
      }
    },
    [sessionId, draft],
  )

  const startNewSession = useCallback(() => {
    draftsRef.current.set(sessionId, draft)
    abortRef.current?.abort()
    setSending(false)
    setSessionId(newSessionId())
    setMessages([])
    setDraft('')
    setError('')
    setStats(EMPTY_STATS)
  }, [sessionId, draft])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setSending(false)
    setMessages(prev => prev.map(m => (m.streaming ? { ...m, streaming: false } : m)))
  }, [])

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || sending || !sessionId) return

      const userMsg: CcMessage = { id: localId(), role: 'user', text, createdAt: Date.now() }
      const assistantId = localId()
      const assistantMsg: CcMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
        streaming: true,
        tools: [],
      }
      setMessages(prev => [...prev, userMsg, assistantMsg])
      setDraft('')
      setSending(true)
      setError('')

      const ac = new AbortController()
      abortRef.current = ac

      const patch = (fn: (m: CcMessage) => CcMessage) => {
        setMessages(prev => prev.map(m => (m.id === assistantId ? fn(m) : m)))
      }

      try {
        const res = await fetch('/api/cc-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, text }),
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '')
          throw new Error(detail.slice(0, 200) || `HTTP ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // SSE 以空行分帧
          let sep = buffer.indexOf('\n\n')
          while (sep !== -1) {
            const frame = buffer.slice(0, sep)
            buffer = buffer.slice(sep + 2)
            sep = buffer.indexOf('\n\n')

            let eventName = 'message'
            const dataLines: string[] = []
            for (const line of frame.split('\n')) {
              if (line.startsWith('event: ')) eventName = line.slice(7).trim()
              else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
            }
            if (dataLines.length === 0) continue
            let payload: Record<string, unknown>
            try {
              payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
            } catch {
              continue
            }

            if (eventName === 'delta') {
              const chunk = String(payload.text || '')
              patch(m => ({ ...m, text: m.text + chunk }))
            } else if (eventName === 'thinking') {
              const chunk = String(payload.text || '')
              patch(m => ({ ...m, thinking: (m.thinking || '') + chunk }))
            } else if (eventName === 'recall') {
              patch(m => ({ ...m, recall: payload as unknown as CcMessage['recall'] }))
            } else if (eventName === 'tool') {
              const tool = payload as unknown as CcToolEvent
              patch(m => ({ ...m, tools: [...(m.tools || []), tool] }))
            } else if (eventName === 'done') {
              patch(m => ({ ...m, streaming: false }))
              if (payload.stats) setStats(payload.stats as CcSessionStats)
              void refreshSessions()
            } else if (eventName === 'error') {
              setError(String(payload.message || '出错了'))
              patch(m => ({ ...m, streaming: false }))
            }
          }
        }
        patch(m => (m.streaming ? { ...m, streaming: false } : m))
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') setError(err.message || String(err))
        patch(m => (m.streaming ? { ...m, streaming: false } : m))
      } finally {
        abortRef.current = null
        setSending(false)
      }
    },
    [sessionId, sending, refreshSessions],
  )

  return {
    sessionId,
    sessions,
    sessionsLoading,
    messages,
    historyLoading,
    draft,
    setDraft,
    sending,
    stats,
    error,
    setError,
    send,
    stop,
    switchSession,
    startNewSession,
  }
}
