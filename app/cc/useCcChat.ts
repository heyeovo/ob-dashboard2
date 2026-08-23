'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CcAttachment,
  CcCacheSnapshot,
  CcCompactionEvent,
  CcContextSnapshot,
  CcEngine,
  CcMessage,
  CcPermDecided,
  CcPermRequest,
  CcProUsage,
  CcSessionListItem,
  CcSessionStats,
  CcToolEvent,
} from './types'
import { EMPTY_STATS } from './types'
import type { CcMode } from '@/app/lib/ccModes'
import type { CcUpstreamConfig, CcUpstreamPick } from './upstream'
import {
  EMPTY_UPSTREAM,
  modelsFor,
  pickFromConfig,
  providerModelForSdkModel,
  upstreamFromHaven,
} from './upstream'
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
import {
  deliveryFromError,
  effectiveEngine as resolveEffectiveEngine,
  newTurnRequestId,
  normalizeProviderUsage,
  normalizeTurnContext,
  providerSelectionLocked,
} from './engineRouting'

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

type RetryTurn = {
  assistantId: string
  requestId: string
  expectedLastRoundId: number
  engine: CcEngine
  attachmentIds: string[]
}

type SessionHistorySnapshot = {
  cachedAt: number
  messages: CcMessage[]
  historyBeforeId: number | null
  hasEarlierHistory: boolean
  historyTurnCount: number
  mode: CcMode
  dailyReviewEnabled: boolean
  localEnginePreference: CcEngine
  pick: CcUpstreamPick
  ccPick: CcUpstreamPick
  ccRoutePicks: CcRoutePicks
  selfhostPick: CcUpstreamPick
  webSettings: CcWebSettings
  promptModuleOverrides: Record<string, boolean>
  credChosen: boolean
  resumeHint: string
  resumeHintLaneId: string
  lastRoundId: number
}

type CcRoutePicks = {
  subscription: CcUpstreamPick
  api: CcUpstreamPick
}

function routePicksFromConfig(config: CcUpstreamConfig): CcRoutePicks {
  const base = pickFromConfig(config)
  const provider = config.providers.find(item => item.id === config.defaultProviderId) || config.providers[0]
  const subscriptionModel = config.defaultKind === 'subscription'
    ? config.defaultModel || config.subscriptionModels[0] || ''
    : config.subscriptionModels[0] || ''
  const apiModel = config.defaultKind === 'api'
    ? config.defaultModel || provider?.models[0] || ''
    : provider?.models[0] || ''
  return {
    subscription: { ...base, kind: 'subscription', providerId: '', model: subscriptionModel },
    api: { ...base, kind: 'api', providerId: provider?.id || '', model: apiModel },
  }
}

function laneIdForPick(pick: CcUpstreamPick): string {
  return pick.kind === 'subscription' ? 'subscription' : `api:${pick.providerId || 'default'}`
}

const INITIAL_HISTORY_LIMIT = 50
const SESSION_HISTORY_CACHE_TTL_MS = 60_000
const MAX_CACHED_SESSIONS = 5

function rememberSessionHistory(
  cache: Map<string, SessionHistorySnapshot>,
  sessionId: string,
  snapshot: SessionHistorySnapshot,
) {
  cache.delete(sessionId)
  cache.set(sessionId, snapshot)
  while (cache.size > MAX_CACHED_SESSIONS) {
    const oldestSessionId = cache.keys().next().value
    if (!oldestSessionId) break
    cache.delete(oldestSessionId)
  }
}

export function useCcChat(personaId = '', isRemote: boolean | null = false) {
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState<CcSessionListItem[]>([])
  const [deletedSessions, setDeletedSessions] = useState<CcSessionListItem[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [messages, setMessages] = useState<CcMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [earlierHistoryLoading, setEarlierHistoryLoading] = useState(false)
  const [historyBeforeId, setHistoryBeforeId] = useState<number | null>(null)
  const [hasEarlierHistory, setHasEarlierHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stats, setStats] = useState<CcSessionStats>(EMPTY_STATS)
  const [proUsage, setProUsage] = useState<CcProUsage | null>(null)
  // 读历史时数出来的轮数。进程被回收后 stats.turnCount 归零，用它兜底
  const [historyTurnCount, setHistoryTurnCount] = useState(0)
  const [error, setError] = useState('')
  const [localEnginePreference, setLocalEnginePreference] = useState<CcEngine>('cc')
  const [engineSaving, setEngineSaving] = useState(false)
  const [promptModuleOverrides, setPromptModuleOverrides] = useState<Record<string, boolean>>({})
  const [promptModulesSaving, setPromptModulesSaving] = useState(false)
  const promptModuleOverridesRef = useRef<Record<string, boolean>>({})
  const effectiveEngine = resolveEffectiveEngine(isRemote, localEnginePreference)
  const effectiveEngineRef = useRef<CcEngine>(effectiveEngine)
  useEffect(() => {
    effectiveEngineRef.current = effectiveEngine
  }, [effectiveEngine])
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
  const upstreamRef = useRef<CcUpstreamConfig>(EMPTY_UPSTREAM)
  // cc 的 provider 是子进程启动参数；selfhost 每轮直连，二者不能共用一份选择状态。
  const initialPick = pickFromConfig(EMPTY_UPSTREAM)
  const [pick, setPick] = useState<CcUpstreamPick>(initialPick)
  const ccPickRef = useRef<CcUpstreamPick>(initialPick)
  const ccRoutePicksRef = useRef<CcRoutePicks>(routePicksFromConfig(EMPTY_UPSTREAM))
  const selfhostPickRef = useRef<CcUpstreamPick>(initialPick)
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

  const refreshProUsage = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/cc-pro-usage?session_id=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (res.ok && data.ok && data.usage) setProUsage(data.usage as CcProUsage)
    } catch {
      // 额度是辅助信息，读取失败不能影响聊天。
    }
  }, [sessionId])

  useEffect(() => {
    if (effectiveEngine !== 'cc' || pick.kind !== 'subscription') return
    const initialTimer = window.setTimeout(() => void refreshProUsage(), 0)
    const pollTimer = window.setInterval(() => void refreshProUsage(), 60_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(pollTimer)
    }
  }, [effectiveEngine, pick.kind, refreshProUsage])

  // 草稿分会话保存（切走再回来还在），跟 Polaris 一样
  const draftsRef = useRef<Map<string, string>>(new Map())
  const historyCacheRef = useRef<Map<string, SessionHistorySnapshot>>(new Map())
  const historyLoadedAtRef = useRef(0)
  const historyAbortRef = useRef<AbortController | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastRoundIdRef = useRef(0)
  const activeTurnRef = useRef<{ assistantId: string; engine: CcEngine } | null>(null)
  // 停止请求发过就不要再发 —— interrupt 一次就够，重复发没意义。done/error 到达时复位。
  const stoppingRef = useRef(false)
  // 第 5 条 resume：切回旧会话时从历史最后一轮读出的 cc session id。
  // 进程已丢时随下一句带给服务端接回上下文；服务端有活进程会忽略它。
  const resumeHintRef = useRef('')
  const resumeHintLaneIdRef = useRef('')
  // 5.5 换窗 handoff：首条消息带走的数据。发完即清。
  const handoffRef = useRef<{ bucketIds: string[]; turns: number; fromSessionId: string | null } | null>(null)
  const dailyReviewEnabledRef = useRef(true)

  // 上游配置：进页面拉一次。拉不到就用空配置（引擎层会退回 .env.local）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cc-upstream', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled || !data.ok) return
        const config = upstreamFromHaven(data.config as Record<string, unknown>)
        upstreamRef.current = config
        setUpstream(config)
        // 上游配置可能比旧会话历史晚返回；已有窗口选择不能被默认模型覆盖。
        const normalizeLoadedPick = (current: CcUpstreamPick) => {
          const providerId = current.kind === 'api'
            ? current.providerId || config.defaultProviderId || config.providers[0]?.id || ''
            : ''
          const candidates = modelsFor(config, current.kind, providerId)
          const model = current.model
            ? providerModelForSdkModel(current.model, candidates, current.kind)
            : candidates[0] || ''
          return { ...current, providerId, model }
        }
        ccRoutePicksRef.current = {
          subscription: normalizeLoadedPick(ccRoutePicksRef.current.subscription),
          api: normalizeLoadedPick(ccRoutePicksRef.current.api),
        }
        ccPickRef.current = ccRoutePicksRef.current[ccPickRef.current.kind]
        selfhostPickRef.current = normalizeLoadedPick(selfhostPickRef.current)
        setPick(effectiveEngineRef.current === 'selfhost' ? selfhostPickRef.current : ccPickRef.current)
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
    const timer = window.setTimeout(() => setSessionId(newSessionId()), 0)
    return () => window.clearTimeout(timer)
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
      const [activeResponse, deletedResponse] = await Promise.all([
        fetch(`/api/cc-turns?limit=60${qs}`, { cache: 'no-store' }),
        fetch(`/api/cc-turns?limit=60&deleted=1${qs}`, { cache: 'no-store' }),
      ])
      const [activeData, deletedData] = await Promise.all([
        activeResponse.json(),
        deletedResponse.json(),
      ])
      if (activeData.ok && Array.isArray(activeData.sessions)) setSessions(activeData.sessions)
      if (deletedData.ok && Array.isArray(deletedData.sessions)) setDeletedSessions(deletedData.sessions)
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
        body: JSON.stringify({
          session_id: targetSessionId,
          title: cleanedTitle,
          persona_id: personaId,
          local_engine_preference: localEnginePreference,
        }),
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
  }, [localEnginePreference, personaId])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSessions(), 0)
    return () => window.clearTimeout(timer)
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
    const initialTimer = window.setTimeout(() => void refreshPending(), 0)
    const timer = setInterval(refreshPending, 5_000)
    return () => {
      window.clearTimeout(initialTimer)
      clearInterval(timer)
    }
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
      if (sessionId && !sending) {
        rememberSessionHistory(historyCacheRef.current, sessionId, {
          cachedAt: historyLoadedAtRef.current,
          messages,
          historyBeforeId,
          hasEarlierHistory,
          historyTurnCount,
          mode,
          dailyReviewEnabled: dailyReviewEnabledRef.current,
          localEnginePreference,
          pick,
          ccPick: ccPickRef.current,
          ccRoutePicks: ccRoutePicksRef.current,
          selfhostPick: selfhostPickRef.current,
          webSettings,
          promptModuleOverrides,
          credChosen,
          resumeHint: resumeHintRef.current,
          resumeHintLaneId: resumeHintLaneIdRef.current,
          lastRoundId: lastRoundIdRef.current,
        })
      } else if (sessionId) {
        // 正在生成时的消息可能只是尚未落库的半截，不能覆盖已验证快照。
        historyCacheRef.current.delete(sessionId)
      }
      abortRef.current?.abort()
      historyAbortRef.current?.abort()
      historyAbortRef.current = null
      setSending(false)
      setSessionId(nextId)
      setDraft(draftsRef.current.get(nextId) || '')
      setError('')
      setStats(EMPTY_STATS)
      // 待批准是按会话分的，切走先清空，轮询会把新会话那份拉回来
      setPending([])
      setDecided([])
      setAutoAllowEdits(false)
      const defaultPick = pickFromConfig(upstreamRef.current)
      const cached = historyCacheRef.current.get(nextId)
      if (cached) {
        setMessages(cached.messages)
        setHistoryTurnCount(cached.historyTurnCount)
        setHistoryBeforeId(cached.historyBeforeId)
        setHasEarlierHistory(cached.hasEarlierHistory)
        setMode(cached.mode)
        dailyReviewEnabledRef.current = cached.dailyReviewEnabled
        setLocalEnginePreference(cached.localEnginePreference)
        setPick(cached.pick)
        ccPickRef.current = cached.ccPick
        ccRoutePicksRef.current = cached.ccRoutePicks || routePicksFromConfig(upstreamRef.current)
        selfhostPickRef.current = cached.selfhostPick
        setWebSettings(cached.webSettings)
        const cachedPromptOverrides = cached.promptModuleOverrides || {}
        setPromptModuleOverrides(cachedPromptOverrides)
        promptModuleOverridesRef.current = cachedPromptOverrides
        setCredChosen(cached.credChosen)
        resumeHintRef.current = cached.resumeHint
        resumeHintLaneIdRef.current = cached.resumeHintLaneId
        lastRoundIdRef.current = cached.lastRoundId
        historyLoadedAtRef.current = cached.cachedAt
      } else {
        setMessages([])
        setHistoryTurnCount(0)
        setHistoryBeforeId(null)
        setHasEarlierHistory(false)
        setLocalEnginePreference('cc')
        setPromptModuleOverrides({})
        promptModuleOverridesRef.current = {}
        setMode('chat')
        dailyReviewEnabledRef.current = true
        setWebSettings(webDefaults)
        setCredChosen(false)
        const defaultRoutes = routePicksFromConfig(upstreamRef.current)
        ccRoutePicksRef.current = defaultRoutes
        ccPickRef.current = defaultRoutes[defaultPick.kind]
        selfhostPickRef.current = defaultPick
        setPick(defaultPick)
        resumeHintRef.current = ''
        resumeHintLaneIdRef.current = ''
        lastRoundIdRef.current = 0
        historyLoadedAtRef.current = 0
      }

      const cacheIsFresh = cached && Date.now() - cached.cachedAt < SESSION_HISTORY_CACHE_TTL_MS
      if (cacheIsFresh) {
        setHistoryLoading(false)
        return
      }

      setHistoryLoading(!cached)
      const historyController = new AbortController()
      historyAbortRef.current = historyController
      try {
        // raw=1：thinking 和工具调用都在 raw_json 里，不要它历史就只剩正文。
        // 体积可控 —— 存的是工具的调用参数（文件路径、搜索词），不是返回结果。
        const res = await fetch(
          `/api/cc-turns?session_id=${encodeURIComponent(nextId)}&limit=${INITIAL_HISTORY_LIMIT}&raw=1`,
          { cache: 'no-store', signal: historyController.signal },
        )
        const data = await res.json()
        if (data.ok && Array.isArray(data.turns)) {
          const turns = data.turns as HavenTurnRow[]
          const restoredMessages = turnsToMessages(turns)
          const restoredHistoryBeforeId = turns[0]?.id ?? null
          const restoredHasEarlierHistory = turns.length === INITIAL_HISTORY_LIMIT
          const restoredLastRoundId = turns.reduce(
            (largest, turn) => Math.max(largest, Number(turn.round_id || 0)),
            0,
          )
          const sessionState = data.session as {
            local_engine_preference?: string
            selfhost_overrides?: { provider_id?: unknown; model?: unknown }
            cc_overrides?: {
              active_cred?: unknown
              subscription?: { model?: unknown; effort?: unknown; thinking?: unknown }
              api?: { provider_id?: unknown; model?: unknown; effort?: unknown; thinking?: unknown }
            }
            prompt_module_overrides?: Record<string, boolean>
            mode?: string
            daily_review_enabled?: boolean
          } | null
          const restoredEngine = sessionState?.local_engine_preference === 'selfhost' ? 'selfhost' : 'cc'
          const selfhostProviderId = String(sessionState?.selfhost_overrides?.provider_id || '').trim()
          const selfhostModel = String(sessionState?.selfhost_overrides?.model || '').trim()
          const restoredPromptModuleOverrides = sessionState?.prompt_module_overrides
            && typeof sessionState.prompt_module_overrides === 'object'
            ? sessionState.prompt_module_overrides
            : {}
          // 进程没了内存里的轮数就归零，用库里的行数补上。
          // 花费补不了（要价格表），保持 0。
          const knownTurnCount = sessions.find(session => session.session_id === nextId)?.turn_count || 0
          const restoredHistoryTurnCount = Math.max(turns.length, knownTurnCount)
          // 老会话是什么模式就照它显示，别让它看起来能改
          const restoredMode = sessionState?.mode === 'chat' || sessionState?.mode === 'work'
            ? sessionState.mode
            : modeOfTurns(turns)
          const restoredDailyReviewEnabled = sessionState?.daily_review_enabled !== false
          // 第 4 + 5 条：从最后一轮读回本窗配置和 resume 接回点
          const meta = metaOfTurns(turns)
          let restoredCcRoutePicks = routePicksFromConfig(upstreamRef.current)
          let restoredCcKind: CcUpstreamPick['kind'] = defaultPick.kind
          let restoredCcPick = restoredCcRoutePicks[restoredCcKind]
          let restoredSelfhostPick = { ...defaultPick }
          let restoredWebSettings = webDefaults
          let restoredCredChosen = false
          if (meta.settings) {
            const s = meta.settings
            const nextKind =
              s.cred === 'subscription' ? 'subscription' : s.cred === 'api' ? 'api' : undefined
            const nextProviderId = s.providerId ?? ''
            const candidates = modelsFor(upstreamRef.current, nextKind || 'api', nextProviderId)
            restoredCcPick = {
              ...restoredCcPick,
              kind: s.cred === 'subscription' ? 'subscription' : s.cred === 'api' ? 'api' : restoredCcPick.kind,
              providerId: s.providerId ?? restoredCcPick.providerId,
              model: s.model
                ? providerModelForSdkModel(s.model, candidates, nextKind || 'api')
                : restoredCcPick.model,
              effort: (s.effort as CcUpstreamPick['effort']) ?? restoredCcPick.effort,
              thinking: s.thinkingOn ?? restoredCcPick.thinking,
            }
            restoredCcKind = restoredCcPick.kind
            restoredCcRoutePicks = { ...restoredCcRoutePicks, [restoredCcKind]: restoredCcPick }
            // 存过 cred 就当「有人定过」，右上角照它显示订阅 / api
            if (s.cred === 'subscription' || s.cred === 'api') restoredCredChosen = true
            if (s.web) restoredWebSettings = s.web
          }
          const storedCc = sessionState?.cc_overrides
          const applyStoredCcPick = (
            kind: CcUpstreamPick['kind'],
            raw: { provider_id?: unknown; model?: unknown; effort?: unknown; thinking?: unknown } | undefined,
          ) => {
            if (!raw) return
            const current = restoredCcRoutePicks[kind]
            const providerId = kind === 'api'
              ? String(raw.provider_id || current.providerId).trim()
              : ''
            const candidates = modelsFor(upstreamRef.current, kind, providerId)
            restoredCcRoutePicks = {
              ...restoredCcRoutePicks,
              [kind]: {
                ...current,
                providerId,
                model: raw.model
                  ? providerModelForSdkModel(String(raw.model), candidates, kind)
                  : current.model,
                effort: (raw.effort as CcUpstreamPick['effort']) || current.effort,
                thinking: typeof raw.thinking === 'boolean' ? raw.thinking : current.thinking,
              },
            }
          }
          applyStoredCcPick('subscription', storedCc?.subscription)
          applyStoredCcPick('api', storedCc?.api)
          if (storedCc?.active_cred === 'subscription' || storedCc?.active_cred === 'api') {
            restoredCcKind = storedCc.active_cred
            restoredCredChosen = true
          }
          restoredCcPick = restoredCcRoutePicks[restoredCcKind]
          // selfhost 的事实源是 Haven 窗口覆盖，优先于最后一轮 cc 的运行时元数据。
          if (selfhostProviderId || selfhostModel) {
            restoredSelfhostPick = {
              ...restoredSelfhostPick,
              kind: 'api',
              providerId: selfhostProviderId || restoredSelfhostPick.providerId,
              model: selfhostModel || restoredSelfhostPick.model,
            }
            restoredCredChosen = true
          }
          // Vercel 必须保留本地首选（通常是 cc），但当前实际执行器固定为 selfhost。
          // 设置卡也要跟实际执行器走，不能因此显示 cc / 全局默认的 provider 和模型。
          const restoredEffectiveEngine = resolveEffectiveEngine(isRemote, restoredEngine)
          const restoredPick = restoredEffectiveEngine === 'selfhost' ? restoredSelfhostPick : restoredCcPick
          const restoredAt = Date.now()

          setMessages(restoredMessages)
          setHistoryBeforeId(restoredHistoryBeforeId)
          setHasEarlierHistory(restoredHasEarlierHistory)
          setHistoryTurnCount(restoredHistoryTurnCount)
          setMode(restoredMode)
          dailyReviewEnabledRef.current = restoredDailyReviewEnabled
          setWebSettings(restoredWebSettings)
          setCredChosen(restoredCredChosen)
          ccPickRef.current = restoredCcPick
          ccRoutePicksRef.current = restoredCcRoutePicks
          selfhostPickRef.current = restoredSelfhostPick
          setPick(restoredPick)
          setLocalEnginePreference(restoredEngine)
          setPromptModuleOverrides(restoredPromptModuleOverrides)
          promptModuleOverridesRef.current = restoredPromptModuleOverrides
          resumeHintRef.current = meta.ccSessionId
          const legacyMetaKind = meta.settings?.cred === 'subscription'
            ? 'subscription'
            : meta.settings?.cred === 'api'
              ? 'api'
              : null
          resumeHintLaneIdRef.current = legacyMetaKind
            ? laneIdForPick({ ...restoredCcPick, kind: legacyMetaKind, providerId: meta.settings?.providerId || '' })
            : ''
          lastRoundIdRef.current = restoredLastRoundId
          historyLoadedAtRef.current = restoredAt
          rememberSessionHistory(historyCacheRef.current, nextId, {
            cachedAt: restoredAt,
            messages: restoredMessages,
            historyBeforeId: restoredHistoryBeforeId,
            hasEarlierHistory: restoredHasEarlierHistory,
            historyTurnCount: restoredHistoryTurnCount,
            mode: restoredMode,
            dailyReviewEnabled: restoredDailyReviewEnabled,
            localEnginePreference: restoredEngine,
            pick: restoredPick,
            ccPick: restoredCcPick,
            ccRoutePicks: restoredCcRoutePicks,
            selfhostPick: restoredSelfhostPick,
            webSettings: restoredWebSettings,
            promptModuleOverrides: restoredPromptModuleOverrides,
            credChosen: restoredCredChosen,
            resumeHint: meta.ccSessionId,
            resumeHintLaneId: resumeHintLaneIdRef.current,
            lastRoundId: restoredLastRoundId,
          })
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError') && !cached) {
          setError('历史消息读取失败')
        }
      } finally {
        if (historyAbortRef.current === historyController) {
          historyAbortRef.current = null
          setHistoryLoading(false)
        }
      }
    },
    [
      sessionId,
      draft,
      sending,
      messages,
      historyBeforeId,
      hasEarlierHistory,
      historyTurnCount,
      mode,
      localEnginePreference,
      pick,
      webSettings,
      promptModuleOverrides,
      credChosen,
      webDefaults,
      sessions,
      isRemote,
    ],
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
    setLocalEnginePreference('cc')
    setPromptModuleOverrides({})
    promptModuleOverridesRef.current = {}
    lastRoundIdRef.current = 0
    setWebSettings(webDefaults)
    // 新对话没有接回点
    resumeHintRef.current = ''
    resumeHintLaneIdRef.current = ''
    dailyReviewEnabledRef.current = true
    // 新对话回到配置里的默认上游。模式不重置 —— 用户刚点的那个模式就是他要的
    const defaultPick = pickFromConfig(upstream)
    ccRoutePicksRef.current = routePicksFromConfig(upstream)
    ccPickRef.current = ccRoutePicksRef.current[defaultPick.kind]
    selfhostPickRef.current = defaultPick
    setPick(defaultPick)
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
      const deleted = sessions.find(session => session.session_id === targetSessionId)
      setSessions(previous => previous.filter(session => session.session_id !== targetSessionId))
      if (deleted) setDeletedSessions(previous => [{ ...deleted, deleted_at: new Date().toISOString() }, ...previous])
      if (targetSessionId === sessionId) startNewSession()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除窗口失败')
      return false
    }
  }, [sessionId, sessions, startNewSession])

  const permanentlyDeleteSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId) return false
    try {
      const res = await fetch('/api/cc-turns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: targetSessionId,
          permanent: true,
          confirm_session_id: targetSessionId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(String(data.error || '永久删除失败'))
      setDeletedSessions(previous => previous.filter(session => session.session_id !== targetSessionId))
      draftsRef.current.delete(targetSessionId)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '永久删除失败')
      return false
    }
  }, [])

  const changeEngine = useCallback(async (next: CcEngine) => {
    if (!sessionId || !personaId || next === localEnginePreference) return
    if (isRemote === true) {
      setError('Vercel 环境仅支持自建引擎；本地首选没有被修改。')
      return
    }
    const previous = localEnginePreference
    const previousPick = pick
    const nextPick = next === 'selfhost' ? selfhostPickRef.current : ccPickRef.current
    setPick(nextPick)
    setLocalEnginePreference(next)
    setEngineSaving(true)
    setError('')
    try {
      const res = await fetch('/api/cc-turns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          persona_id: personaId,
          local_engine_preference: next,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(String(data.error || '引擎首选保存失败'))
    } catch (reason) {
      setPick(previousPick)
      setLocalEnginePreference(previous)
      setError(reason instanceof Error ? reason.message : '引擎首选保存失败')
    } finally {
      setEngineSaving(false)
    }
  }, [isRemote, localEnginePreference, personaId, pick, sessionId])

  const setPromptModuleEnabled = useCallback(async (
    moduleId: string,
    defaultEnabled: boolean,
    enabled: boolean,
  ): Promise<boolean> => {
    const id = moduleId.trim()
    if (!sessionId || !personaId || !id || promptModulesSaving) return false
    const previous = promptModuleOverridesRef.current
    const next = { ...previous }
    if (enabled === defaultEnabled) delete next[id]
    else next[id] = enabled
    promptModuleOverridesRef.current = next
    setPromptModuleOverrides(next)
    setPromptModulesSaving(true)
    setError('')
    try {
      const response = await fetch('/api/cc-turns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          persona_id: personaId,
          prompt_module_overrides: next,
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || payload.ok !== true) {
        throw new Error(String(payload.error || '提示词模块状态保存失败'))
      }
      return true
    } catch (reason) {
      promptModuleOverridesRef.current = previous
      setPromptModuleOverrides(previous)
      setError(reason instanceof Error ? reason.message : '提示词模块状态保存失败')
      return false
    } finally {
      setPromptModulesSaving(false)
    }
  }, [personaId, promptModulesSaving, sessionId])

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
      setLocalEnginePreference('cc')
      setPromptModuleOverrides({})
      promptModuleOverridesRef.current = {}
      lastRoundIdRef.current = 0
      setPending([])
      setDecided([])
      setAutoAllowEdits(false)
      setSettingsNote('')
      setWebSettings(webDefaults)
      resumeHintRef.current = ''
      resumeHintLaneIdRef.current = ''
      const defaultPick = pickFromConfig(upstream)
      ccRoutePicksRef.current = routePicksFromConfig(upstream)
      ccPickRef.current = ccRoutePicksRef.current[defaultPick.kind]
      selfhostPickRef.current = defaultPick
      setPick(defaultPick)
      setMode(payload.mode)
      dailyReviewEnabledRef.current = payload.includeDailyReview

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
   *   · cc 的 kind / providerId 切换独立 Claude session，并从 Haven 补中间轮次
   *   · selfhost 每轮重新直连，providerId / model 保存到 Haven 后下一轮立即生效
   */
  // 换窗带来的消息只是新会话的上下文，不代表这一窗已经开口。
  // 旧会话从 Haven 读回时 historyTurnCount > 0；本窗发言后会出现非历史消息。
  const sessionStarted =
    historyTurnCount > 0 || messages.some(message => !message.fromHistory)
  // 自建轮次不能锁住 cc 的启动模式；只有 cc 真正开口后才锁。
  const ccSessionStarted = messages.some(
    message => message.role === 'assistant' && message.engine !== 'selfhost' && !message.handoff,
  )

  const applyPick = useCallback(
    async (next: Partial<CcUpstreamPick>) => {
      if (sending) {
        setSettingsNote('正在回复，结束后才能切换线路')
        return
      }
      const requestedKind = next.kind || pick.kind
      const base = effectiveEngine === 'cc' && requestedKind !== pick.kind
        ? ccRoutePicksRef.current[requestedKind]
        : pick
      const merged: CcUpstreamPick = { ...base, ...next, kind: requestedKind }
      const switchedUpstream = merged.kind !== pick.kind || merged.providerId !== pick.providerId

      if (switchedUpstream) {
        // cc 换站会改变子进程环境变量；selfhost 则只需为下一轮选择新直连目标。
        const models = modelsFor(upstream, merged.kind, merged.providerId)
        if (!models.includes(merged.model)) merged.model = models[0] || ''
        // 用户亲手点过订阅 / api，从这里开始按他选的送
        setCredChosen(true)
      }

      const previousPick = pick
      setPick(merged)
      if (effectiveEngine === 'selfhost') {
        selfhostPickRef.current = merged
        if (merged.kind !== 'api' || !merged.providerId || !merged.model) {
          selfhostPickRef.current = previousPick
          setPick(previousPick)
          setSettingsNote('自建引擎需要选择 api 中转站和模型')
          return
        }
        try {
          const res = await fetch('/api/cc-session-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              engine: 'selfhost',
              persona_id: personaId,
              provider_id: merged.providerId,
              model: merged.model,
            }),
          })
          const data = await res.json()
          if (!res.ok || !data.ok) throw new Error(String(data.error || '保存失败'))
          setSettingsNote('已生效')
        } catch (reason) {
          selfhostPickRef.current = previousPick
          setPick(previousPick)
          setSettingsNote(`没有改上：${reason instanceof Error ? reason.message : '保存失败'}`)
        }
        return
      }
      const previousRoutes = ccRoutePicksRef.current
      ccPickRef.current = merged
      ccRoutePicksRef.current = { ...previousRoutes, [merged.kind]: merged }
      setCredChosen(true)

      try {
        const res = await fetch('/api/cc-session-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            engine: 'cc',
            persona_id: personaId,
            cred: merged.kind,
            provider_id: merged.providerId,
            model: merged.model,
            effort: merged.effort,
            thinking: merged.thinking,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(String(data.error || '保存失败'))
        if (data.stats) setStats(data.stats as CcSessionStats)
        else if (switchedUpstream) setStats(EMPTY_STATS)
        setSettingsNote(
          switchedUpstream
            ? '线路已切换；下一句话会恢复目标线路，并补入中间对话'
            : data.applied === false
              ? '已保存，下一句话时生效'
              : '已生效',
        )
      } catch (reason) {
        ccRoutePicksRef.current = previousRoutes
        ccPickRef.current = previousPick
        setPick(previousPick)
        setSettingsNote(`没有改上：${reason instanceof Error ? reason.message : '保存失败'}`)
      }
    },
    [pick, upstream, sessionId, effectiveEngine, personaId, sending],
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
    if (effectiveEngine === 'selfhost') {
      const active = activeTurnRef.current
      abortRef.current?.abort()
      if (active) {
        setMessages(previous => previous.map(message => (
          message.id === active.assistantId
            ? {
                ...message,
                streaming: false,
                interrupted: true,
                deliveryState: 'stopped',
                deliveryNote: '已停止生成；这段未完成回复没有保存。',
              }
            : message
        )))
      }
      return
    }
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
  }, [effectiveEngine, sessionId])

  const compactNow = useCallback(async (): Promise<{ ok: boolean; compacted: boolean; error: string }> => {
    if (effectiveEngine !== 'cc' || mode !== 'work') {
      return { ok: false, compacted: false, error: '手动压缩只在 CC 工作模式提供' }
    }
    if (sending || stats.busy || stats.compacting) {
      return { ok: false, compacted: false, error: '当前还有一轮未结束，请稍后再压缩' }
    }
    setStats(current => ({ ...current, busy: true, compacting: true }))
    try {
      const response = await fetch('/api/cc-compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const data = await response.json() as {
        ok?: boolean
        compacted?: boolean
        error?: string
        message?: string
        compaction?: CcCompactionEvent | null
        stats?: CcSessionStats
      }
      if (data.stats) setStats(data.stats)
      if (!response.ok || !data.ok) {
        return { ok: false, compacted: false, error: String(data.error || '手动压缩失败') }
      }
      const compaction = data.compaction
      if (compaction) {
        setMessages(previous => [...previous, {
          id: `compact-${compaction.id}`,
          role: 'system',
          text: '',
          compaction,
          laneId: laneIdForPick(pick),
          createdAt: compaction.at,
        }])
      }
      return {
        ok: true,
        compacted: Boolean(data.compacted),
        error: data.compacted ? '' : String(data.message || '当前历史还不足以压缩'),
      }
    } catch (reason) {
      return { ok: false, compacted: false, error: (reason as Error).message || '手动压缩失败' }
    } finally {
      setStats(current => ({ ...current, busy: false, compacting: false }))
    }
  }, [effectiveEngine, mode, pick, sending, sessionId, stats.busy, stats.compacting])

  const send = useCallback(
    async (rawText: string, retry?: RetryTurn, selectedAttachments: CcAttachment[] = []) => {
      const text = rawText.trim()
      const attachmentIds = retry?.attachmentIds || selectedAttachments.map(item => item.id)
      if ((!text && attachmentIds.length === 0) || sending || !sessionId) return

      const requestId = retry?.requestId || newTurnRequestId()
      const expectedLastRoundId = retry?.expectedLastRoundId ?? lastRoundIdRef.current
      const turnEngine = retry?.engine || effectiveEngine
      const turnPick = { ...pick }
      const userMsg: CcMessage = {
        id: localId(),
        role: 'user',
        text,
        attachments: selectedAttachments,
        createdAt: Date.now(),
      }
      const assistantId = retry?.assistantId || localId()
      const assistantMsg: CcMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
        streaming: true,
        tools: [],
        process: [],
        engine: turnEngine,
        laneId: turnEngine === 'cc' ? laneIdForPick(turnPick) : undefined,
        requestId,
        deliveryState: 'generating',
        retryText: text,
        retryExpectedLastRoundId: expectedLastRoundId,
        retryAttachmentIds: attachmentIds,
      }
      if (retry) {
        setMessages(previous => previous.map(message => message.id === assistantId ? assistantMsg : message))
      } else {
        setMessages(prev => [...prev, userMsg, assistantMsg])
      }
      setDraft('')
      setSending(true)
      setError('')
      activeTurnRef.current = { assistantId, engine: turnEngine }

      const ac = new AbortController()
      abortRef.current = ac

      const patch = (fn: (m: CcMessage) => CcMessage) => {
        setMessages(prev => prev.map(m => (m.id === assistantId ? fn(m) : m)))
      }

      try {
        const endpoint = turnEngine === 'selfhost' ? '/api/cc-chat-selfhost' : '/api/cc-chat'
        const strictPayload = {
          session_id: sessionId,
          request_id: requestId,
          expected_last_round_id: expectedLastRoundId,
          persona_id: personaId,
          text,
          attachment_ids: attachmentIds,
          mode,
          include_daily_review: dailyReviewEnabledRef.current,
        }
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // persona_id 每轮都带上：服务端按它取提示词/记忆/引擎。
          // 会话中途换人不生效（子进程已经起来了），服务端会沿用第一轮那个。
          //
          // 每轮带当前手动选择。mode 仍由窗口锁定；cred / provider_id 改变时，
          // 服务端切到目标线路自己的 Claude session，不跨凭据复用 query。
          body: JSON.stringify(turnEngine === 'selfhost' ? strictPayload : {
            ...strictPayload,
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
            ...(resumeHintLaneIdRef.current ? { resume_hint_lane_id: resumeHintLaneIdRef.current } : {}),
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
          onStart: payload => {
            patch(message => ({
              ...message,
              requestId: String(payload.request_id || requestId),
              engine: turnEngine,
              deliveryState: 'generating',
            }))
          },
          onContext: payload => {
            patch(message => ({ ...message, context: normalizeTurnContext(payload) }))
          },
          onContextSnapshot: payload => {
            const snapshot = payload as unknown as CcContextSnapshot
            patch(message => ({ ...message, contextSnapshot: snapshot }))
            setStats(current => ({
              ...current,
              contextSnapshot: snapshot,
              contextTokens: snapshot.totalTokens,
              contextMaxTokens: snapshot.maxTokens,
            }))
          },
          onCompact: payload => {
            const compaction = payload as unknown as CcCompactionEvent
            patch(message => ({
              ...message,
              process: [
                ...closeOpenThinking(message.process),
                { type: 'compact', id: compaction.id, compaction },
              ],
            }))
            setStats(current => ({
              ...current,
              lastCompaction: compaction,
              compactionCount: current.lastCompaction?.id === compaction.id
                ? current.compactionCount
                : current.compactionCount + 1,
            }))
          },
          onCompactStatus: payload => {
            setStats(current => ({ ...current, compacting: payload.compacting === true }))
          },
          onInit: payload => {
            patch(message => ({
              ...message,
              engine: payload.engine === 'selfhost' ? 'selfhost' : turnEngine,
              providerId: String(payload.provider_id || ''),
              providerLabel: String(payload.provider_label || ''),
              model: String(payload.model || ''),
            }))
          },
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
          onUsage: payload => {
            patch(message => ({
              ...message,
              usage: normalizeProviderUsage(payload),
              streaming: false,
              deliveryState: 'saving',
              deliveryNote: '回复已生成，正在保存到 Haven…',
            }))
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
            const usage = normalizeProviderUsage(payload.usage)
            const doneStats = payload.stats as CcSessionStats | undefined
            const cacheSnapshot: CcCacheSnapshot | null = doneStats?.cacheRefreshedAt
              ? {
                  refreshedAt: doneStats.cacheRefreshedAt,
                  systemTtlMs: 60 * 60 * 1000,
                  sessionTtlMs: 5 * 60 * 1000,
                  model: doneStats.model,
                }
              : null
            const interrupted = payload.interrupted === true
            const interruptedReason = payload.interrupted_reason === 'pro_limit'
              ? 'pro_limit'
              : interrupted
                ? 'user_stop'
                : undefined
            const replayed = payload.idempotent_replay === true
            const continuityTurns = Number(payload.continuity_turns || 0)
            const roundId = Number(payload.round_id || 0)
            if (roundId > 0) lastRoundIdRef.current = Math.max(lastRoundIdRef.current, roundId)
            patch(m => {
              const process = closeOpenThinking(m.process)
              return {
                ...m,
                process,
                streaming: false,
                usage: usage || m.usage,
                cacheSnapshot: cacheSnapshot || m.cacheSnapshot,
                interrupted: interrupted || m.interrupted,
                interruptedReason: interruptedReason || m.interruptedReason,
                thinkingMs: thinkingDuration(process) || undefined,
                roundId: roundId || m.roundId,
                deliveryState: replayed ? 'replayed' : 'saved',
                deliveryNote: interruptedReason === 'pro_limit'
                  ? m.text.trim()
                    ? 'Pro 额度中断；已生成内容和用户消息均已保存到 Haven'
                    : 'Pro 额度不足，未生成回复；用户消息已保存到 Haven'
                  : replayed
                  ? '已从 Haven 幂等重放，没有重复生成或写入。'
                  : continuityTurns > 0
                    ? `已向当前 CC 线路补入其他线路期间 ${continuityTurns} 轮对话；已保存到 Haven`
                    : '已保存到 Haven',
              }
            })
            if (doneStats) setStats(doneStats)
          },
          onAfter: payload => {
            // done 之后的收尾（写库 + 上下文用量）。到这儿输入框早就解锁了，
            // 这个事件只更新顶部那几个数字和会话列表。
            if (payload.stats) setStats(payload.stats as CcSessionStats)
            if (turnEngine === 'cc' && turnPick.kind === 'subscription') void refreshProUsage()
            void refreshSessions()
          },
          onError: payload => {
            const delivery = deliveryFromError(payload)
            if (delivery.keepGenerated) {
              // 已经生成的正文、thinking 和工具过程留在原消息位置；错误原因显示在
              // 消息自己的状态栏，不再把半截正文挪进页面顶部的红色错误框。
              setError('')
              patch(message => {
                const process = closeOpenThinking(message.process)?.map(event => (
                  event.type === 'tool' && event.tool.status === 'running'
                    ? {
                        ...event,
                        tool: {
                          ...event.tool,
                          status: 'error' as const,
                          error: event.tool.error || '本轮异常结束，工具未完成',
                        },
                      }
                    : event
                ))
                return {
                  ...message,
                  process,
                  tools: message.tools?.map(tool => tool.status === 'running'
                    ? {
                        ...tool,
                        status: 'error' as const,
                        error: tool.error || '本轮异常结束，工具未完成',
                      }
                    : tool),
                  streaming: false,
                  thinkingMs: thinkingDuration(process) || undefined,
                  deliveryState: delivery.state,
                  deliveryNote: delivery.note,
                }
              })
            } else {
              setError(delivery.note)
              setMessages(prev => prev.filter(message => message.id !== assistantId))
            }
          },
        })
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError') {
          setMessages(previous => previous.flatMap(message => {
            if (message.id !== assistantId) return [message]
            if (!message.text && !message.thinking) return []
            return [{
              ...message,
              streaming: false,
              interrupted: true,
              deliveryState: 'stopped',
              deliveryNote: '已停止生成；这段未完成回复没有保存。',
            }]
          }))
        } else {
          setError(err.message || String(err))
          setMessages(prev => prev.filter(message => message.id !== assistantId))
        }
        // 浏览器断流时服务端的 iterator 可能还在等；主动回收，避免 busy 锁残留。
        //（consumeSseStream 只有「流结束却没收到完成事件」才抛，走到这里必然无终态）
        if (turnEngine === 'cc') {
          void fetch(`/api/cc-chat?session_id=${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
          }).catch(() => undefined)
        }
      } finally {
        abortRef.current = null
        activeTurnRef.current = null
        stoppingRef.current = false
        setSending(false)
      }
    },
    [sessionId, sending, personaId, refreshSessions, refreshPending, refreshProUsage, mode, pick, credChosen, webSettings, effectiveEngine],
  )

  const retryPersistence = useCallback((message: CcMessage) => {
    if (!message.requestId || !message.retryText || message.retryExpectedLastRoundId == null || !message.engine) return
    void send(message.retryText, {
      assistantId: message.id,
      requestId: message.requestId,
      expectedLastRoundId: message.retryExpectedLastRoundId,
      engine: message.engine,
      attachmentIds: message.retryAttachmentIds || [],
    })
  }, [send])

  const clearAttachment = useCallback(async (messageId: string, attachmentId: string) => {
    try {
      const response = await fetch(`/api/cc-attachments/${encodeURIComponent(attachmentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || payload.ok !== true) throw new Error(String(payload.error || '清除内容失败'))
      setMessages(previous => previous.map(message => message.id === messageId
        ? {
            ...message,
            attachments: message.attachments?.map(item => item.id === attachmentId
              ? { ...item, cleared: true, previewUrl: undefined }
              : item),
          }
        : message))
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除内容失败')
      return false
    }
  }, [sessionId])

  const clearAttachmentsByKind = useCallback(async (kind: 'image' | 'file') => {
    const label = kind === 'image' ? '图片' : '文件'
    try {
      const response = await fetch('/api/cc-attachments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, all: true, kind }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || payload.ok !== true) throw new Error(String(payload.error || `清除窗口${label}失败`))
      setMessages(previous => previous.map(message => ({
        ...message,
        attachments: message.attachments?.map(item => item.kind === kind
          ? { ...item, cleared: true, previewUrl: undefined }
          : item),
      })))
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `清除窗口${label}失败`)
      return false
    }
  }, [sessionId])

  const activeImageCount = messages.reduce((count, message) => count
    + (message.attachments || []).filter(item => item.kind === 'image' && !item.cleared).length, 0)
  const activeFileCount = messages.reduce((count, message) => count
    + (message.attachments || []).filter(item => item.kind === 'file' && !item.cleared).length, 0)

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
  const latestTurn = [...messages].reverse().find(message => message.role === 'assistant' && !message.handoff)

  return {
    sessionId,
    sessions,
    deletedSessions,
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
    proUsage,
    refreshProUsage,
    error,
    setError,
    send,
    stop,
    compactNow,
    switchSession,
    startNewSession,
    renameSession,
    deleteSession,
    permanentlyDeleteSession,
    localEnginePreference,
    effectiveEngine,
    engineSaving,
    changeEngine,
    promptModuleOverrides,
    promptModulesSaving,
    setPromptModuleEnabled,
    latestTurn,
    retryPersistence,
    clearAttachment,
    clearAttachmentsByKind,
    activeImageCount,
    activeFileCount,
    isRemote,
    // 5.2：模式 + 本窗口设置
    mode,
    setMode,
    /** cc 已经在这个窗口开口 —— 模式和联网工具不能再改。 */
    modeLocked: ccSessionStarted,
    /** 生成期间不允许换线路；空闲时 Pro / API / selfhost 都可手动往返。 */
    providerLocked: providerSelectionLocked(effectiveEngine, sending),
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
