'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CcMessage, CcRecallInfo, CcSessionListItem, CcSessionStats, CcToolEvent } from './types'
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
  client?: string
  /** 写库时原样存的那份，thinking / 工具 / 召回都在里面。要 raw=1 才有 */
  raw_json?: string
}

/** client 列形如 `ob2-chat/<persona_id>`（4.5b 起写）。解不出来就是无主的老消息。 */
function personaOfClient(client: string | undefined): string {
  const value = (client || '').trim()
  return value.startsWith('ob2-chat/') ? value.slice('ob2-chat/'.length).trim() : ''
}

/**
 * 读回 raw_json 里那些「不是正文」的部分：thinking、工具调用、召回。
 *
 * ⚠️ 纯前端显示，**不进 prompt**。那段 thinking 是模型自己的草稿，
 * 塞回上下文等于同一段话以「用户资料」的身份出现两遍，会污染它对自己说过什么的判断。
 * ⚠️ 工具只有调用参数，没有返回结果 —— 引擎层还没回传 tool_result（见 types.ts）。
 */
function parseTurnRaw(rawJson: string | undefined): {
  thinking: string
  tools: CcToolEvent[]
  recall: CcRecallInfo | null
} {
  const empty = { thinking: '', tools: [] as CcToolEvent[], recall: null }
  if (!rawJson) return empty
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(rawJson)
    if (!parsed || typeof parsed !== 'object') return empty
    raw = parsed as Record<string, unknown>
  } catch {
    // Haven 侧超长会存成带 _truncated 的存根，解不出来就当没有
    return empty
  }
  const rawTools = Array.isArray(raw.tools) ? (raw.tools as Record<string, unknown>[]) : []
  return {
    thinking: typeof raw.thinking === 'string' ? raw.thinking : '',
    tools: rawTools.map((t, i) => ({
      name: String(t.name || '工具'),
      id: String(t.id || `t${i}`),
      input: t.input,
    })),
    recall:
      raw.recall && typeof raw.recall === 'object' ? (raw.recall as unknown as CcRecallInfo) : null,
  }
}

function turnsToMessages(turns: HavenTurnRow[]): CcMessage[] {
  const out: CcMessage[] = []
  for (const t of turns) {
    const at = Date.parse(t.created_at) || Date.now()
    if (t.user_text?.trim()) {
      out.push({ id: `h${t.id}u`, role: 'user', text: t.user_text, createdAt: at, fromHistory: true })
    }
    if (t.assistant_text?.trim()) {
      const extra = parseTurnRaw(t.raw_json)
      out.push({
        id: `h${t.id}a`,
        role: 'assistant',
        text: t.assistant_text,
        createdAt: at,
        fromHistory: true,
        personaId: personaOfClient(t.client),
        thinking: extra.thinking || undefined,
        tools: extra.tools.length ? extra.tools : undefined,
        recall: extra.recall,
      })
    }
  }
  return out
}

export function useCcChat(personaId = '') {
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState<CcSessionListItem[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [messages, setMessages] = useState<CcMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stats, setStats] = useState<CcSessionStats>(EMPTY_STATS)
  // 读历史时数出来的轮数。进程被回收后 stats.turnCount 归零，用它兜底
  const [historyTurnCount, setHistoryTurnCount] = useState(0)
  const [error, setError] = useState('')

  // 草稿分会话保存（切走再回来还在），跟 Polaris 一样
  const draftsRef = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  // 首次进页面：开一个新会话 id + 拉会话列表
  useEffect(() => {
    setSessionId(newSessionId())
  }, [])

  // 会话列表按协作者隔离：只显示属于当前这个的。
  // 4.5b 之前的老对话没归属，服务端一律算给第一个协作者（ombre），用户拍板的。
  const refreshSessions = useCallback(async () => {
    try {
      const qs = personaId ? `&persona_id=${encodeURIComponent(personaId)}` : ''
      const res = await fetch(`/api/cc-turns?limit=60${qs}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.ok && Array.isArray(data.sessions)) setSessions(data.sessions)
    } catch {
      /* 会话列表拉不到不影响聊天 */
    } finally {
      setSessionsLoading(false)
    }
  }, [personaId])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  // 顶部的费用 / 缓存剩余时间：每 20 秒问一次服务端
  //
  // ⚠️ 这份 stats 只反映「当前活着的那个进程」。进程被回收后轮数和花费都归零 ——
  // 它们不在 Haven 里，只活在内存。轮数下面用历史行数补齐；
  // 花费补不了（要按中转站 + 模型的价格表算），见 HANDOFF 待办。
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
      setHistoryTurnCount(0)

      setHistoryLoading(true)
      try {
        // raw=1：thinking 和工具调用都在 raw_json 里，不要它历史就只剩正文。
        // 体积可控 —— 存的是工具的调用参数（文件路径、搜索词），不是返回结果。
        const res = await fetch(
          `/api/cc-turns?session_id=${encodeURIComponent(nextId)}&limit=200&raw=1`,
          { cache: 'no-store' },
        )
        const data = await res.json()
        if (data.ok && Array.isArray(data.turns)) {
          const turns = data.turns as HavenTurnRow[]
          setMessages(turnsToMessages(turns))
          // 进程没了内存里的轮数就归零，用库里的行数补上。
          // 花费补不了（要价格表），保持 0。
          setHistoryTurnCount(turns.length)
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
    setHistoryTurnCount(0)
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
          // persona_id 每轮都带上：服务端按它取提示词/记忆/引擎。
          // 会话中途换人不生效（子进程已经起来了），服务端会沿用第一轮那个。
          body: JSON.stringify({ session_id: sessionId, text, persona_id: personaId }),
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
    [sessionId, sending, personaId, refreshSessions],
  )

  // 轮数取两者的大者：进程活着时它自己的计数是准的（这一轮刚加完，库还没写）；
  // 进程没了就用历史行数。
  const mergedStats: CcSessionStats = {
    ...stats,
    turnCount: Math.max(stats.turnCount, historyTurnCount),
  }

  return {
    sessionId,
    sessions,
    sessionsLoading,
    messages,
    historyLoading,
    draft,
    setDraft,
    sending,
    stats: mergedStats,
    error,
    setError,
    send,
    stop,
    switchSession,
    startNewSession,
  }
}
