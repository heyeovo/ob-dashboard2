'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CcMessage,
  CcPermDecided,
  CcPermRequest,
  CcSessionListItem,
  CcSessionStats,
  CcToolEvent,
} from './types'
import { EMPTY_STATS } from './types'
import type { CcMode } from '@/app/lib/ccModes'
import type { CcUpstreamConfig, CcUpstreamPick } from './upstream'
import { EMPTY_UPSTREAM, modelsFor, pickFromConfig, upstreamFromHaven } from './upstream'
import type { HandoffPayload } from './CcHandoffDialog'
import {
  DEFAULT_WEB_SETTINGS,
  normalizeWebSettings,
  type CcWebSettings,
} from './webSettings'
import {
  ACTIVE_SESSION_KEY,
  closeOpenThinking,
  localId,
  metaOfTurns,
  modeOfTurns,
  newSessionId,
  thinkingDuration,
  turnsToMessages,
  type HavenTurnRow,
} from './ccHistory'
import { consumeSseStream } from './ccSseConsumer'

// /cc 聊天页的状态与 SSE 消费。UI 组件不碰 fetch，全在这里。
//
// ⚠️ session_id 的角色：前端生成、贯穿全程。它同时是
//   · hook 送去 Haven 召回的分组键
//   · 写回 conversation_turns 的分组键
//   · 会话列表里认的那个 id
// claude code 自己的 session id 在服务端另存（做 resume 用），前端不管。
//
// 9.5 拆出来的两部分：
//   · ccHistory.ts    —— Haven 历史行 → 界面消息的纯转换（测试过的那批）
//   · ccSseConsumer.ts —— SSE 流消费（读流 → 切帧 → 按事件名分发）
// 本文件只管「界面状态」：谁在聊、发了什么、等什么批准、上游选了哪套。

export function useCcChat(personaId = '') {
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState<CcSessionListItem[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [messages, setMessages] = useState<CcMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [earlierHistoryLoading, setEarlierHistoryLoading] = useState(false)
  const [historyBeforeId, setHistoryBeforeId] = useState<number | null>(null)
  const [hasEarlierHistory, setHasEarlierHistory] = useState(false)
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
  const [webDefaults, setWebDefaults] = useState<CcWebSettings>(DEFAULT_WEB_SETTINGS)
  const [webSettings, setWebSettings] = useState<CcWebSettings>(DEFAULT_WEB_SETTINGS)
  const [webSaving, setWebSaving] = useState(false)
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
  // 停止请求发过就不要再发 —— interrupt 一次就够，重复发没意义。done/error 到达时复位。
  const stoppingRef = useRef(false)
  // 第 5 条 resume：切回旧会话时从历史最后一轮读出的 cc session id。
  // 进程已丢时随下一句带给服务端接回上下文；服务端有活进程会忽略它。
  const resumeHintRef = useRef('')
  // 5.5 换窗 handoff：首条消息带走的数据。发完即清。
  const handoffRef = useRef<{ bucketIds: string[]; turns: number; fromSessionId: string | null } | null>(null)

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

  // 联网工具默认值单独存 Haven。窗口内修改只改副本，用户明确点保存才覆盖默认值。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cc-web-settings', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled || !data.ok) return
        const settings = normalizeWebSettings(data.settings as Record<string, unknown>)
        setWebDefaults(settings)
        setWebSettings(settings)
      } catch {
        /* Haven 暂时不可用时沿用安全默认值，不阻断聊天 */
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

  const renameSession = useCallback(async (targetSessionId: string, title: string) => {
    const cleanedTitle = title.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (!targetSessionId || !cleanedTitle) return false
    try {
      const res = await fetch('/api/cc-turns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: targetSessionId, title: cleanedTitle }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(String(data.error || '重命名失败'))
      setSessions(previous => previous.map(session => (
        session.session_id === targetSessionId ? { ...session, title: cleanedTitle } : session
      )))
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重命名失败')
      return false
    }
  }, [])

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

  /** 点批准 / 拒绝。Bash / WebFetch 可按 SDK 的具体建议选择会话级或永久规则。 */
  const answerPermission = useCallback(
    async (
      id: string,
      allow: boolean,
      opts?: {
        remember?: boolean
        reason?: string
        scope?: 'once' | 'session' | 'always'
      },
    ) => {
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
            scope: opts?.scope || 'once',
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
      setHistoryBeforeId(null)
      setHasEarlierHistory(false)
      // 待批准是按会话分的，切走先清空，轮询会把新会话那份拉回来
      setPending([])
      setDecided([])
      setAutoAllowEdits(false)
      setWebSettings(webDefaults)

      setHistoryLoading(true)
      try {
        // raw=1：thinking 和工具调用都在 raw_json 里，不要它历史就只剩正文。
        // 体积可控 —— 存的是工具的调用参数（文件路径、搜索词），不是返回结果。
        const res = await fetch(
          `/api/cc-turns?session_id=${encodeURIComponent(nextId)}&limit=100&raw=1`,
          { cache: 'no-store' },
        )
        const data = await res.json()
        if (data.ok && Array.isArray(data.turns)) {
          const turns = data.turns as HavenTurnRow[]
          setMessages(turnsToMessages(turns))
          setHistoryBeforeId(turns[0]?.id ?? null)
          setHasEarlierHistory(turns.length === 100)
          // 进程没了内存里的轮数就归零，用库里的行数补上。
          // 花费补不了（要价格表），保持 0。
          const knownTurnCount = sessions.find(session => session.session_id === nextId)?.turn_count || 0
          setHistoryTurnCount(Math.max(turns.length, knownTurnCount))
          // 老会话是什么模式就照它显示，别让它看起来能改
          setMode(modeOfTurns(turns))
          // 第 4 + 5 条：从最后一轮读回本窗配置和 resume 接回点
          const meta = metaOfTurns(turns)
          resumeHintRef.current = meta.ccSessionId
          if (meta.settings) {
            const s = meta.settings
            setPick(prev => ({
              ...prev,
              kind: s.cred === 'subscription' ? 'subscription' : s.cred === 'api' ? 'api' : prev.kind,
              providerId: s.providerId ?? prev.providerId,
              model: s.model ?? prev.model,
              effort: (s.effort as CcUpstreamPick['effort']) ?? prev.effort,
              thinking: s.thinkingOn ?? prev.thinking,
            }))
            // 存过 cred 就当「有人定过」，右上角照它显示订阅 / api
            if (s.cred === 'subscription' || s.cred === 'api') setCredChosen(true)
            if (s.web) setWebSettings(s.web)
          }
        }
      } catch {
        setError('历史消息读取失败')
      } finally {
        setHistoryLoading(false)
      }
    },
    [sessionId, draft, webDefaults, sessions],
  )

  const loadEarlierHistory = useCallback(async () => {
    if (!sessionId || !hasEarlierHistory || historyBeforeId == null || earlierHistoryLoading) return
    setEarlierHistoryLoading(true)
    try {
      const res = await fetch(
        `/api/cc-turns?session_id=${encodeURIComponent(sessionId)}&limit=100&before_id=${historyBeforeId}&raw=1`,
        { cache: 'no-store' },
      )
      const data = await res.json()
      if (!data.ok || !Array.isArray(data.turns)) throw new Error('历史消息读取失败')
      const turns = data.turns as HavenTurnRow[]
      if (turns.length > 0) {
        setMessages(previous => [...turnsToMessages(turns), ...previous])
        setHistoryBeforeId(turns[0].id)
      }
      setHasEarlierHistory(turns.length === 100)
    } catch {
      setError('更早的历史消息读取失败')
    } finally {
      setEarlierHistoryLoading(false)
    }
  }, [sessionId, hasEarlierHistory, historyBeforeId, earlierHistoryLoading])

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
    setHistoryBeforeId(null)
    setHasEarlierHistory(false)
    setPending([])
    setDecided([])
    setAutoAllowEdits(false)
    setSettingsNote('')
    setWebSettings(webDefaults)
    // 新对话没有接回点
    resumeHintRef.current = ''
    // 新对话回到配置里的默认上游。模式不重置 —— 用户刚点的那个模式就是他要的
    setPick(pickFromConfig(upstream))
  }, [sessionId, draft, upstream, webDefaults])

  const deleteSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId) return false
    try {
      const res = await fetch('/api/cc-turns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: targetSessionId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(String(data.error || '删除窗口失败'))
      void fetch(`/api/cc-chat?session_id=${encodeURIComponent(targetSessionId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
      draftsRef.current.delete(targetSessionId)
      setSessions(previous => previous.filter(session => session.session_id !== targetSessionId))
      if (targetSessionId === sessionId) startNewSession()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除窗口失败')
      return false
    }
  }, [sessionId, startNewSession])

  const startWithHandoff = useCallback(
    async (payload: HandoffPayload) => {
      // 先做 startNewSession 同款重置
      draftsRef.current.set(sessionId, draft)
      abortRef.current?.abort()
      setSending(false)
      const nextId = newSessionId()
      setSessionId(nextId)
      setMessages([])
      setDraft('')
      setError('')
      setStats(EMPTY_STATS)
      setHistoryTurnCount(0)
      setHistoryBeforeId(null)
      setHasEarlierHistory(false)
      setPending([])
      setDecided([])
      setAutoAllowEdits(false)
      setSettingsNote('')
      setWebSettings(webDefaults)
      resumeHintRef.current = ''
      setPick(pickFromConfig(upstream))
      setMode(payload.mode)

      // 存 handoff 数据，首条 send 时带走
      handoffRef.current = {
        bucketIds: payload.bucketIds,
        turns: payload.turns,
        fromSessionId: payload.fromSessionId,
      }

      // 要带对话原文：拉回来转成「淡色历史消息」铺在消息流最前面。
      // 走 messages 数组（不再用独立状态）—— 跟真消息同一条渲染路径，发消息后不会消失，
      // 顺序天然正序（旧在上、最新贴着第一句）。标 handoff+fromHistory：淡色显示、不可重发。
      if (payload.turns > 0 && payload.fromSessionId) {
        try {
          const res = await fetch(
            `/api/cc-turns?session_id=${encodeURIComponent(payload.fromSessionId)}&limit=${payload.turns}`,
            { cache: 'no-store' },
          )
          const data = await res.json()
          if (data.ok && Array.isArray(data.turns)) {
            const msgs: CcMessage[] = []
            // cc-turns 返回就是时间正序（旧→新），直接铺，最新那条在最下面贴着第一句
            for (const t of data.turns) {
              const at = Date.parse(t.created_at) || Date.now()
              if (t.user_text?.trim()) {
                msgs.push({ id: `ho${t.id}u`, role: 'user', text: t.user_text, createdAt: at, fromHistory: true, handoff: true })
              }
              if (t.assistant_text?.trim()) {
                msgs.push({ id: `ho${t.id}a`, role: 'assistant', text: t.assistant_text, createdAt: at, fromHistory: true, handoff: true })
              }
            }
            // 只在还没发第一句时铺（用户可能已抢先发言，不覆盖真消息）
            setMessages(prev => (prev.length === 0 ? msgs : prev))
          }
        } catch {
          // 拉不到不影响新对话
        }
      }
    },
    [sessionId, draft, upstream, webDefaults],
  )

  /**
   * 改本窗口设置。
   *
   * 三档待遇，界面上要说清楚：
   *   · model / effort / thinking → 打 /api/cc-session-settings，当场生效（换模型会清缓存）
   *   · kind（订阅↔api）/ providerId（换中转站）→ 只存在前端，下一个新对话才生效
   *   · 已经开口的会话换 kind / provider → 拦住，提示新建对话
   */
  // 换窗带来的消息只是新会话的上下文，不代表这一窗已经开口。
  // 旧会话从 Haven 读回时 historyTurnCount > 0；本窗发言后会出现非历史消息。
  const sessionStarted =
    historyTurnCount > 0 || messages.some(message => !message.fromHistory)

  const applyPick = useCallback(
    async (next: Partial<CcUpstreamPick>) => {
      const merged: CcUpstreamPick = { ...pick, ...next }
      const switchedUpstream = merged.kind !== pick.kind || merged.providerId !== pick.providerId

      if (switchedUpstream) {
        // 换站/换凭据会换掉子进程的环境变量，跑着的进程改不了
        const models = modelsFor(upstream, merged.kind, merged.providerId)
        if (!models.includes(merged.model)) merged.model = models[0] || ''
        setPick(merged)
        // 用户亲手点过订阅 / api，从这里开始按他选的送
        setCredChosen(true)
        setSettingsNote(
          sessionStarted ? '换供应商要新建对话才生效（这一窗还是原来那套）' : '已选好，这一窗生效',
        )
        return
      }

      setPick(merged)
      if (!sessionStarted) {
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
    [pick, sessionStarted, upstream, sessionId],
  )

  const applyWebSettings = useCallback(
    (next: Partial<CcWebSettings>) => {
      if (sessionStarted) {
        setSettingsNote('联网工具配置要新建对话才生效')
        return
      }
      setWebSettings(current =>
        normalizeWebSettings({ ...current, ...next } as Record<string, unknown>),
      )
      setSettingsNote('已应用到这一个窗口；要作为以后默认值，请点“保存为新窗口默认”')
    },
    [sessionStarted],
  )

  const saveWebDefaults = useCallback(async () => {
    setWebSaving(true)
    try {
      const res = await fetch('/api/cc-web-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webSettings),
      })
      const data = await res.json()
      if (!data.ok) {
        setSettingsNote(String(data.error || '联网工具默认值保存失败'))
        return
      }
      const saved = normalizeWebSettings(data.settings as Record<string, unknown>)
      setWebDefaults(saved)
      setWebSettings(saved)
      setSettingsNote('已保存为新窗口默认值')
    } catch (error) {
      setSettingsNote((error as Error).message || '联网工具默认值保存失败')
    } finally {
      setWebSaving(false)
    }
  }, [webSettings])

  const stop = useCallback(() => {
    // 不 abort：abort 会断开 SSE，服务端那边把这一轮整块丢掉。改成发「停止」请求，
    // 服务端调 interrupt() 优雅收尾 —— 已生成的字留在界面、写进 Haven，上下文也保住。
    // SSE 连接保持开着，等服务端把 done / after 推回来，这一轮才算真正收尾。
    if (stoppingRef.current) return
    stoppingRef.current = true
    void fetch('/api/cc-stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => undefined)
  }, [sessionId])

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
        process: [],
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
            web_search_enabled: webSettings.searchEnabled,
            web_fetch_enabled: webSettings.fetchEnabled,
            web_max_searches: webSettings.maxSearchesPerTurn,
            web_max_fetches: webSettings.maxFetchesPerTurn,
            web_fetch_target_tokens: webSettings.fetchTargetTokens,
            web_max_sources: webSettings.maxDisplayedSources,
            web_domain_mode: webSettings.domainMode,
            web_domains: webSettings.domains,
            // 第 5 条：进程已丢时靠它 resume 接回上下文；有活进程服务端会忽略
            ...(resumeHintRef.current ? { resume_hint: resumeHintRef.current } : {}),
            // 5.5 换窗 handoff：首条消息带桶 id 和源会话 id，服务端拉内容注入
            ...(handoffRef.current ? {
              handoff_bucket_ids: handoffRef.current.bucketIds,
              handoff_turns: handoffRef.current.turns,
              handoff_from_session: handoffRef.current.fromSessionId,
            } : {}),
          }),
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '')
          throw new Error(detail.slice(0, 200) || `HTTP ${res.status}`)
        }

        // 5.5：handoff 只随首条带一次，发出去就清
        if (handoffRef.current) handoffRef.current = null

        // SSE 消费（读流 → 切帧 → 按事件分发）在 ccSseConsumer 里，
        // 这里只写「每个事件怎么改界面状态」。
        // 只有「流结束却没收到完成事件」才会抛错 —— 见下面 catch。
        await consumeSseStream(res.body, {
          onDelta: payload => {
            const chunk = String(payload.text || '')
            const id = String(payload.id || `text-${Date.now()}`)
            patch(m => {
              const process = closeOpenThinking(m.process)
              const last = process.at(-1)
              const continuesTextSegment = last?.type === 'text' && last.id === id
              if (continuesTextSegment) {
                process[process.length - 1] = { ...last, text: last.text + chunk }
              } else {
                process.push({ type: 'text', id, text: chunk })
              }
              return {
                ...m,
                process,
                thinkingMs: thinkingDuration(process) || undefined,
                text: continuesTextSegment || !m.text ? m.text + chunk : `${m.text}\n\n${chunk}`,
              }
            })
          },
          onThinking: payload => {
            const chunk = String(payload.text || '')
            const id = String(payload.id || `thinking-${Date.now()}`)
            const startedAt =
              typeof payload.startedAt === 'number' ? payload.startedAt : Date.now()
            patch(m => {
              const process = [...(m.process || [])]
              const last = process.at(-1)
              if (last?.type === 'thinking' && last.id === id) {
                process[process.length - 1] = { ...last, text: last.text + chunk }
              } else {
                process.push({ type: 'thinking', id, text: chunk, startedAt })
              }
              return {
                ...m,
                thinking: (m.thinking || '') + chunk,
                process,
              }
            })
          },
          onRecall: payload => {
            patch(m => ({ ...m, recall: payload as unknown as CcMessage['recall'] }))
          },
          onTool: payload => {
            const tool = payload as unknown as CcToolEvent
            patch(m => ({
              ...m,
              process: [
                ...closeOpenThinking(m.process, tool.startedAt || Date.now()),
                { type: 'tool', id: `process-${tool.id}`, tool },
              ],
              tools: [...(m.tools || []), tool],
            }))
          },
          onToolResult: payload => {
            const id = String(payload.id || '')
            const result =
              typeof payload.result === 'string' && payload.result
                ? payload.result
                : undefined
            const error =
              typeof payload.error === 'string' && payload.error
                ? payload.error
                : undefined
            const status =
              payload.status === 'error' || payload.status === 'denied'
                ? payload.status
                : 'completed'
            const durationMs =
              typeof payload.durationMs === 'number' ? payload.durationMs : undefined
            patch(m => ({
              ...m,
              tools: (m.tools || []).map(tool =>
                tool.id === id
                  ? {
                      ...tool,
                      result: result || tool.result,
                      error,
                      status,
                      durationMs,
                    }
                  : tool,
              ),
              process: (m.process || []).map(event =>
                event.type === 'tool' && event.tool.id === id
                  ? {
                      ...event,
                      tool: {
                        ...event.tool,
                        result: result || event.tool.result,
                        error,
                        status,
                        durationMs,
                      },
                    }
                  : event,
              ),
            }))
          },
          onPermission: payload => {
            // 有东西要批准了。对话流当场弹卡片（这一轮正停在服务端等）
            const req = payload as unknown as CcPermRequest
            setPending(prev => (prev.some(p => p.id === req.id) ? prev : [...prev, req]))
          },
          onPermissionResolved: payload => {
            // 别的设备点了 / 超时了 —— 把卡片撤掉
            const id = String(payload.id || '')
            setPending(prev => prev.filter(p => p.id !== id))
            void refreshPending()
          },
          onDone: payload => {
            const usage = (payload.usage || null) as CcMessage['usage']
            const interrupted = payload.interrupted === true
            patch(m => {
              const process = closeOpenThinking(m.process)
              return {
                ...m,
                process,
                streaming: false,
                usage,
                interrupted: interrupted || m.interrupted,
                thinkingMs: thinkingDuration(process) || undefined,
              }
            })
            if (payload.stats) setStats(payload.stats as CcSessionStats)
          },
          onAfter: payload => {
            // done 之后的收尾（写库 + 上下文用量）。到这儿输入框早就解锁了，
            // 这个事件只更新顶部那几个数字和会话列表。
            if (payload.stats) setStats(payload.stats as CcSessionStats)
            void refreshSessions()
          },
          onError: payload => {
            setError(String(payload.message || '出错了'))
            // API / SDK 错误不是助手回复：页面只留错误提示，不留一条假消息。
            setMessages(prev => prev.filter(message => message.id !== assistantId))
          },
        })
      } catch (e) {
        const err = e as Error
        if (err.name !== 'AbortError') setError(err.message || String(err))
        setMessages(prev => prev.filter(message => message.id !== assistantId))
        // 浏览器断流时服务端的 iterator 可能还在等；主动回收，避免 busy 锁残留。
        //（consumeSseStream 只有「流结束却没收到完成事件」才抛，走到这里必然无终态）
        void fetch(`/api/cc-chat?session_id=${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
        }).catch(() => undefined)
      } finally {
        abortRef.current = null
        stoppingRef.current = false
        setSending(false)
      }
    },
    [sessionId, sending, personaId, refreshSessions, mode, pick, credChosen, webSettings],
  )

  // 轮数取两者的大者：进程活着时它自己的计数是准的（这一轮刚加完，库还没写）；
  // 进程没了就用历史行数。
  const mergedStats: CcSessionStats = {
    ...stats,
    turnCount: Math.max(stats.turnCount, historyTurnCount),
  }
  const sessionTitle = sessions.find(session => session.session_id === sessionId)?.title
    || messages.find(message => message.role === 'user' && !message.handoff)?.text.slice(0, 80)
    || '新对话'
  const activeSessionSource = sessions.find(session => session.session_id === sessionId)?.source || ''

  return {
    sessionId,
    sessions,
    sessionsLoading,
    sessionTitle,
    activeSessionSource,
    messages,
    historyLoading,
    earlierHistoryLoading,
    hasEarlierHistory,
    loadEarlierHistory,
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
    renameSession,
    deleteSession,
    // 5.2：模式 + 本窗口设置
    mode,
    setMode,
    /** 这个会话已经开口了 —— 模式和供应商都不能再改 */
    modeLocked: sessionStarted,
    upstream,
    upstreamLoaded,
    pick,
    applyPick,
    webSettings,
    applyWebSettings,
    saveWebDefaults,
    webSaving,
    settingsNote,
    setSettingsNote,
    // 第 5 步
    pending,
    decided,
    autoAllowEdits,
    answerPermission,
    stopAutoAllow,
    refreshPending,
    // 5.5 换窗 handoff
    startWithHandoff,
  }
}
