'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CcMessage,
  CcPermDecided,
  CcPermRequest,
  CcRecallInfo,
  CcSessionListItem,
  CcSessionStats,
  CcToolEvent,
  CcTurnUsage,
} from './types'
import { EMPTY_STATS } from './types'
import type { CcMode } from '@/app/lib/ccModes'
import type { CcUpstreamConfig, CcUpstreamPick } from './upstream'
import { EMPTY_UPSTREAM, modelsFor, pickFromConfig, upstreamFromHaven } from './upstream'

// /cc 聊天页的状态与 SSE 消费。UI 组件不碰 fetch，全在这里。
//
// ⚠️ session_id 的角色：前端生成、贯穿全程。它同时是
//   · hook 送去 Haven 召回的分组键
//   · 写回 conversation_turns 的分组键
//   · 会话列表里认的那个 id
// claude code 自己的 session id 在服务端另存（做 resume 用），前端不管。

const NEW_SESSION_PREFIX = 'ob2-'

/**
 * 当前在聊哪个会话，写进 localStorage 给工作台读。
 *
 * 为什么用 localStorage：工作台是另一个页面（/workbench），它得知道「现在」是哪个会话
 * 才能显示待批准 / 改过的文件。服务端不知道你在看哪个（同时可以有好几个活会话）。
 */
export const ACTIVE_SESSION_KEY = 'ob2-cc-active-session'

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
  usage: CcTurnUsage | null
} {
  const empty = { thinking: '', tools: [] as CcToolEvent[], recall: null, usage: null }
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
    // 5.2 起写库时带 usage。老消息没有 —— 那就不显示 token 面板，不编数字。
    usage:
      raw.usage && typeof raw.usage === 'object' ? (raw.usage as unknown as CcTurnUsage) : null,
  }
}

/**
 * 这个会话是什么模式：看最后一轮 raw 里的 mode。
 * 5.2 之前的老会话没这个字段 —— 一律算工作模式（那时候只有这一种行为）。
 */
function modeOfTurns(turns: HavenTurnRow[]): CcMode {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const rawJson = turns[i]?.raw_json
    if (!rawJson) continue
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>
      if (parsed?.mode === 'chat') return 'chat'
      if (parsed?.mode === 'work') return 'work'
    } catch {
      /* 解不出来接着往前找 */
    }
  }
  return 'work'
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
        usage: extra.usage,
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
  // 第 5 步：正在等点批准的操作。
  // ⚠️ 它的权威副本在服务端队列里 —— 刷新页面 / 换设备打开都靠下面那个轮询拉回来，
  // 不是只靠 SSE 推。SSE 只是让它当场出现。
  const [pending, setPending] = useState<CcPermRequest[]>([])
  const [decided, setDecided] = useState<CcPermDecided[]>([])
  const [autoAllowEdits, setAutoAllowEdits] = useState(false)

  /* ── 5.2：模式 + 上游选择 ── */
  // 闲聊 / 工作。**只在这个会话还没开口之前能改** —— systemPrompt 和 tools 是子进程
  // 启动参数，第一句话一发就定死了。
  const [mode, setMode] = useState<CcMode>('chat')
  const [upstream, setUpstream] = useState<CcUpstreamConfig>(EMPTY_UPSTREAM)
  const [upstreamLoaded, setUpstreamLoaded] = useState(false)
  // 这个窗口选的那套上游。model / effort / thinking 能中途改，kind / providerId 不能
  const [pick, setPick] = useState<CcUpstreamPick>(() => pickFromConfig(EMPTY_UPSTREAM))
  const [settingsNote, setSettingsNote] = useState('')
  /**
   * 订阅还是 api：是「有人真的定过」还是只是我这边的默认值？
   *
   * ⚠️ 没定过就**不往请求里塞 cred** —— 那样服务端会照协作者自己的 engine 走（4.5b 的行为）。
   * 塞了的话，Haven 里还没配上游的时候，所有协作者都会被拽到 api 那边去。
   */
  const [credChosen, setCredChosen] = useState(false)

  // 草稿分会话保存（切走再回来还在），跟 Polaris 一样
  const draftsRef = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  // 这一轮 thinking 的起止，用来显示「深度思考 (2.3s)」。
  // ⚠️ 算的是前端收到第一个 thinking 片段到收到第一个正文片段之间的时间 ——
  // 服务端没单独报思考耗时，这个口径最接近用户感知的「它想了多久」。
  const thinkStartRef = useRef(0)

  // 上游配置：进页面拉一次。拉不到就用空配置（引擎层会退回 .env.local）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cc-upstream', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled || !data.ok) return
        const config = upstreamFromHaven(data.config as Record<string, unknown>)
        setUpstream(config)
        setPick(pickFromConfig(config))
        // 配过东西（有中转站 / 填过订阅模型）才算「定过」，空配置不抢协作者的 engine
        if (config.providers.length > 0 || config.subscriptionModels.length > 0) setCredChosen(true)
      } catch {
        /* 没配置也能聊，走 .env.local 那条老路 */
      } finally {
        if (!cancelled) setUpstreamLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 首次进页面：开一个新会话 id + 拉会话列表
  useEffect(() => {
    setSessionId(newSessionId())
  }, [])

  // 工作台靠这个知道现在在聊哪个会话
  useEffect(() => {
    if (!sessionId) return
    try {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
    } catch {
      /* 隐私模式下写不了，工作台会退回「先去聊天页」的空态 */
    }
  }, [sessionId])

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

  /**
   * 把「现在等着谁点」拉回来。
   *
   * 为什么要轮询而不只靠 SSE：那一轮停在服务端等答复，SSE 流可能早断了
   *（手机切走、页面刷新、发送请求本身被 abort）。5 秒一次，够用又不吵。
   * 有东西挂着时才轮 —— 没挂着的时候页面是安静的。
   */
  const refreshPending = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/cc-permission?session_id=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!data.ok) return
      setPending((data.pending || []) as CcPermRequest[])
      setDecided((data.decided || []) as CcPermDecided[])
      setAutoAllowEdits(data.auto_allow_edits === true)
    } catch {
      /* 拉不到就等下一次 */
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    void refreshPending()
    const timer = setInterval(refreshPending, 5_000)
    return () => clearInterval(timer)
  }, [sessionId, refreshPending])

  /** 点批准 / 拒绝。remember 只影响 Edit / Write，Bash 永远一条一条问。 */
  const answerPermission = useCallback(
    async (id: string, allow: boolean, opts?: { remember?: boolean; reason?: string }) => {
      // 先本地摘掉，按钮点下去立刻有反应（服务端 409 时下一次轮询会把它拉回来）
      setPending(prev => prev.filter(p => p.id !== id))
      try {
        const res = await fetch('/api/cc-permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            id,
            decision: allow ? 'allow' : 'deny',
            remember: opts?.remember === true,
            reason: opts?.reason,
          }),
        })
        const data = await res.json()
        if (!data.ok) {
          setError(String(data.error || '这条批准没送到'))
          void refreshPending()
          return
        }
        setPending((data.pending || []) as CcPermRequest[])
        setDecided((data.decided || []) as CcPermDecided[])
        setAutoAllowEdits(data.auto_allow_edits === true)
      } catch (e) {
        setError((e as Error).message || '这条批准没送到')
        void refreshPending()
      }
    },
    [sessionId, refreshPending],
  )

  /** 关掉「本会话 Edit / Write 都放行」。 */
  const stopAutoAllow = useCallback(async () => {
    setAutoAllowEdits(false)
    try {
      await fetch(`/api/cc-permission?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
    } catch {
      /* 关不掉下次轮询会显示真实状态 */
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
      // 待批准是按会话分的，切走先清空，轮询会把新会话那份拉回来
      setPending([])
      setDecided([])
      setAutoAllowEdits(false)

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
          // 老会话是什么模式就照它显示，别让它看起来能改
          setMode(modeOfTurns(turns))
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
    setPending([])
    setDecided([])
    setAutoAllowEdits(false)
    setSettingsNote('')
    // 新对话回到配置里的默认上游。模式不重置 —— 用户刚点的那个模式就是他要的
    setPick(pickFromConfig(upstream))
  }, [sessionId, draft, upstream])

  /**
   * 改本窗口设置。
   *
   * 三档待遇，界面上要说清楚：
   *   · model / effort / thinking → 打 /api/cc-session-settings，当场生效（换模型会清缓存）
   *   · kind（订阅↔api）/ providerId（换中转站）→ 只存在前端，下一个新对话才生效
   *   · 已经开口的会话换 kind / provider → 拦住，提示新建对话
   */
  const applyPick = useCallback(
    async (next: Partial<CcUpstreamPick>) => {
      const merged: CcUpstreamPick = { ...pick, ...next }
      const started = messages.length > 0
      const switchedUpstream = merged.kind !== pick.kind || merged.providerId !== pick.providerId

      if (switchedUpstream) {
        // 换站/换凭据会换掉子进程的环境变量，跑着的进程改不了
        const models = modelsFor(upstream, merged.kind, merged.providerId)
        if (!models.includes(merged.model)) merged.model = models[0] || ''
        setPick(merged)
        // 用户亲手点过订阅 / api，从这里开始按他选的送
        setCredChosen(true)
        setSettingsNote(
          started ? '换供应商要新建对话才生效（这一窗还是原来那套）' : '已选好，这一窗生效',
        )
        return
      }

      setPick(merged)
      if (!started) {
        setSettingsNote('已选好，发第一句时生效')
        return
      }

      try {
        const res = await fetch('/api/cc-session-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            model: merged.model,
            effort: merged.effort,
            thinking: merged.thinking,
          }),
        })
        const data = await res.json()
        if (!data.ok) {
          setSettingsNote(String(data.error || '这次没改上，等这一轮说完再试'))
          return
        }
        if (data.stats) setStats(data.stats as CcSessionStats)
        setSettingsNote(
          data.applied === false ? String(data.note || '下一句话时生效') : '已生效',
        )
      } catch {
        setSettingsNote('设置没送到，等下再试')
      }
    },
    [pick, messages.length, upstream, sessionId],
  )

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
      thinkStartRef.current = 0

      const patch = (fn: (m: CcMessage) => CcMessage) => {
        setMessages(prev => prev.map(m => (m.id === assistantId ? fn(m) : m)))
      }

      try {
        const res = await fetch('/api/cc-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // persona_id 每轮都带上：服务端按它取提示词/记忆/引擎。
          // 会话中途换人不生效（子进程已经起来了），服务端会沿用第一轮那个。
          //
          // 5.2 起还带这一窗选的那套上游。同样是「第一轮定死」的那几项
          //（mode / cred / provider_id）后面几轮送过去也不会改，服务端沿用启动时那份。
          body: JSON.stringify({
            session_id: sessionId,
            text,
            persona_id: personaId,
            mode,
            // 没人定过就不送 cred，让服务端照协作者的 engine 走
            ...(credChosen ? { cred: pick.kind === 'subscription' ? 'subscription' : 'api' } : {}),
            provider_id: pick.providerId,
            model: pick.model,
            effort: pick.effort,
            thinking: pick.thinking,
          }),
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
              // 第一个正文片段 = 思考结束。之后再来正文不重复计时
              if (thinkStartRef.current) {
                const ms = Date.now() - thinkStartRef.current
                thinkStartRef.current = 0
                patch(m => ({ ...m, thinkingMs: ms, text: m.text + chunk }))
              } else {
                patch(m => ({ ...m, text: m.text + chunk }))
              }
            } else if (eventName === 'thinking') {
              const chunk = String(payload.text || '')
              if (!thinkStartRef.current) thinkStartRef.current = Date.now()
              patch(m => ({ ...m, thinking: (m.thinking || '') + chunk }))
            } else if (eventName === 'recall') {
              patch(m => ({ ...m, recall: payload as unknown as CcMessage['recall'] }))
            } else if (eventName === 'tool') {
              const tool = payload as unknown as CcToolEvent
              patch(m => ({ ...m, tools: [...(m.tools || []), tool] }))
            } else if (eventName === 'permission') {
              // 有东西要批准了。对话流当场弹卡片（这一轮正停在服务端等）
              const req = payload as unknown as CcPermRequest
              setPending(prev => (prev.some(p => p.id === req.id) ? prev : [...prev, req]))
            } else if (eventName === 'permission_resolved') {
              // 别的设备点了 / 超时了 —— 把卡片撤掉
              const id = String(payload.id || '')
              setPending(prev => prev.filter(p => p.id !== id))
              void refreshPending()
            } else if (eventName === 'done') {
              const usage = (payload.usage || null) as CcTurnUsage | null
              // 思考完直接结束（一句话没说）时也把耗时补上
              const thinkMs = thinkStartRef.current ? Date.now() - thinkStartRef.current : 0
              thinkStartRef.current = 0
              patch(m => ({
                ...m,
                streaming: false,
                usage,
                thinkingMs: m.thinkingMs || thinkMs || undefined,
              }))
              if (payload.stats) setStats(payload.stats as CcSessionStats)
            } else if (eventName === 'after') {
              // done 之后的收尾（写库 + 上下文用量）。到这儿输入框早就解锁了，
              // 这个事件只更新顶部那几个数字和会话列表。
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
    [sessionId, sending, personaId, refreshSessions, mode, pick, credChosen],
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
    // 5.2：模式 + 本窗口设置
    mode,
    setMode,
    /** 这个会话已经开口了 —— 模式和供应商都不能再改 */
    modeLocked: messages.length > 0,
    upstream,
    upstreamLoaded,
    pick,
    applyPick,
    settingsNote,
    setSettingsNote,
    // 第 5 步
    pending,
    decided,
    autoAllowEdits,
    answerPermission,
    stopAutoAllow,
    refreshPending,
  }
}
