// /cc 聊天页的历史数据转换（9.5 从 useCcChat 原样抽出，纯函数，可单独测）。
//
// Haven 的一轮（user + assistant 一行）→ 界面上的消息；raw_json 里的
// thinking / 工具 / 召回 / usage → 消息的附属字段。这些转换跟「页面状态」
// 无关，第 10 步的自建引擎也要用同一份（它同样从 conversation_turns 读历史）。

import type {
  CcMessage,
  CcAttachment,
  CcCacheSnapshot,
  CcCompactionEvent,
  CcContextSnapshot,
  CcInterruptedReason,
  CcProcessEvent,
  CcRecallInfo,
  CcRecallModule,
  CcToolEvent,
  CcTurnUsage,
} from './types'
import type { CcMode } from '@/app/lib/ccModes'
import { normalizeWebSettings, type CcWebSettings } from './webSettings'
import { normalizeProviderUsage, normalizeTurnContext } from './engineRouting'
import { buildDisplaySegments, normalizeDisplaySegments, type DisplaySegment } from '@/app/lib/cc/displaySegments'

const NEW_SESSION_PREFIX = 'ob2-'

/**
 * 当前在聊哪个会话，写进 localStorage 给工作台读。
 *
 * 为什么用 localStorage：工作台是另一个页面（/workbench），它得知道「现在」是哪个会话
 * 才能显示待批准 / 改过的文件。服务端不知道你在看哪个（同时可以有好几个活会话）。
 */
export const ACTIVE_SESSION_KEY = 'ob2-cc-active-session'

export function newSessionId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 8)
  return `${NEW_SESSION_PREFIX}${stamp}-${rand}`
}

export function localId() {
  return `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`
}

export function closeOpenThinking(
  process: CcProcessEvent[] | undefined,
  endedAt = Date.now(),
): CcProcessEvent[] {
  const next = [...(process || [])]
  const last = next.at(-1)
  if (last?.type !== 'thinking' || last.durationMs != null) return next
  next[next.length - 1] = {
    ...last,
    durationMs: Math.max(0, endedAt - (last.startedAt || endedAt)),
  }
  return next
}

export function thinkingDuration(process: CcProcessEvent[] | undefined) {
  return (process || []).reduce(
    (total, event) => total + (event.type === 'thinking' ? event.durationMs || 0 : 0),
    0,
  )
}

/** Haven 的一轮（user + assistant 一行）拆成界面上的两条消息。 */
export type HavenTurnRow = {
  id: number
  round_id?: number
  user_text: string
  assistant_text: string
  created_at: string
  source: string
  turn_kind?: 'user' | 'agent_wake'
  client?: string
  /** 写库时原样存的那份，thinking / 工具 / 召回都在里面。要 raw=1 才有 */
  raw_json?: string
  attachments?: Array<{
    id: string
    session_id: string
    filename: string
    kind?: 'image' | 'file'
    mime_type: string
    byte_size: number
    sha256: string
    text_chars?: number
    text_truncated?: boolean
    cleared?: boolean
  }>
}

function normalizeRecall(value: unknown): CcRecallInfo | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const additionalContext = typeof raw.additional_context === 'string' ? raw.additional_context.trim() : ''
  const modules: CcRecallModule[] = Array.isArray(raw.modules)
    ? raw.modules.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const detail = item as Record<string, unknown>
        return [{
          key: String(detail.key || 'memory_card'),
          card_count: Number(detail.card_count || 0),
          chars: Number(detail.chars || 0),
          text: String(detail.text || ''),
        }]
      })
    : additionalContext
      ? [{
          key: 'memory_card',
          card_count: Number(raw.card_count || 0),
          chars: Number(raw.chars || additionalContext.length),
          text: additionalContext,
        }]
      : []
  const domains = Array.isArray(raw.domains) ? raw.domains.map(String).filter(Boolean) : undefined
  const fallbackCardCount = Array.isArray(raw.recalled_ids)
    ? raw.recalled_ids.length
    : modules.reduce((total, detail) => total + detail.card_count, 0)
  const fallbackChars = additionalContext.length
    || modules.reduce((total, detail) => total + (detail.chars || detail.text.length), 0)
  return {
    ok: raw.ok !== false,
    card_count: Number(raw.card_count ?? fallbackCardCount),
    chars: Number(raw.chars ?? fallbackChars),
    elapsed_ms: Number(raw.elapsed_ms || 0),
    injected: typeof raw.injected === 'boolean'
      ? raw.injected
      : Boolean(additionalContext || modules.some(module => module.text.trim())),
    domains,
    error: typeof raw.error === 'string' && raw.error ? raw.error : undefined,
    modules: modules.length ? modules : undefined,
  }
}

function normalizeCompaction(value: unknown): CcCompactionEvent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.trigger !== 'manual' && raw.trigger !== 'auto') return null
  return {
    id: String(raw.id || `compact-${Number(raw.at || 0)}`),
    trigger: raw.trigger,
    preTokens: Math.max(0, Number(raw.preTokens ?? raw.pre_tokens) || 0),
    postTokens: raw.postTokens == null && raw.post_tokens == null
      ? null
      : Math.max(0, Number(raw.postTokens ?? raw.post_tokens) || 0),
    durationMs: raw.durationMs == null && raw.duration_ms == null
      ? null
      : Math.max(0, Number(raw.durationMs ?? raw.duration_ms) || 0),
    at: Number(raw.at || 0) || Date.now(),
  }
}

function normalizeContextSnapshot(value: unknown): CcContextSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const totalTokens = Math.max(0, Number(raw.totalTokens) || 0)
  const maxTokens = Math.max(0, Number(raw.maxTokens) || 0)
  return {
    totalTokens,
    inputTokens: Math.max(0, Number(raw.inputTokens) || 0),
    outputTokens: Math.max(0, Number(raw.outputTokens) || 0),
    maxTokens,
    remainingTokens: Math.max(0, Number(raw.remainingTokens) || (maxTokens ? maxTokens - totalTokens : 0)),
    percentage: Math.max(0, Number(raw.percentage) || (maxTokens ? totalTokens / maxTokens * 100 : 0)),
    updatedAt: Number(raw.updatedAt) || 0,
    model: String(raw.model || ''),
    source: raw.source === 'compact' ? 'compact' : 'stream',
  }
}

function normalizeCacheSnapshot(value: unknown): CcCacheSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const refreshedAt = Math.max(0, Number(raw.refreshedAt) || 0)
  if (!refreshedAt) return null
  return {
    refreshedAt,
    systemTtlMs: Math.max(0, Number(raw.systemTtlMs) || 60 * 60 * 1000),
    sessionTtlMs: Math.max(0, Number(raw.sessionTtlMs) || 5 * 60 * 1000),
    model: String(raw.model || ''),
  }
}

/** client 列形如 `ob2-chat/<persona_id>`（4.5b 起写）。解不出来就是无主的老消息。 */
export function personaOfClient(client: string | undefined): string {
  const value = (client || '').trim()
  if (value.startsWith('ob2-chat/')) return value.slice('ob2-chat/'.length).trim()
  if (value.startsWith('ob2-selfhost/')) return value.slice('ob2-selfhost/'.length).trim()
  return ''
}

/**
 * 读回 raw_json 里那些「不是正文」的部分：thinking、工具调用、召回。
 *
 * ⚠️ 纯前端显示，**不进 prompt**。那段 thinking 是模型自己的草稿，
 * 塞回上下文等于同一段话以「用户资料」的身份出现两遍，会污染它对自己说过什么的判断。
 * MCP 日常工具会带返回结果；Read/Grep/Bash 等工作工具仍只留调用参数。
 */
export function parseTurnRaw(rawJson: string | undefined): {
  thinking: string
  tools: CcToolEvent[]
  process: CcProcessEvent[]
  recall: CcRecallInfo | null
  usage: CcTurnUsage | null
  interrupted: boolean
  interruptedReason: CcInterruptedReason | undefined
  engine: 'cc' | 'selfhost' | undefined
  providerId: string
  providerLabel: string
  laneId: string
  model: string
  context: CcMessage['context']
  contextSnapshot: CcContextSnapshot | null
  cacheSnapshot: CcCacheSnapshot | null
  preCompactions: CcCompactionEvent[]
  displaySegments: DisplaySegment[] | null
  agentWake: { cause: string; at: string; reason?: string; status?: string } | null
  nextWake: { at: string; reason: string } | null
} {
  const empty = {
    thinking: '',
    tools: [] as CcToolEvent[],
    process: [] as CcProcessEvent[],
    recall: null,
    usage: null,
    interrupted: false,
    interruptedReason: undefined,
    engine: undefined,
    providerId: '',
    providerLabel: '',
    laneId: '',
    model: '',
    context: null,
    contextSnapshot: null,
    cacheSnapshot: null,
    preCompactions: [] as CcCompactionEvent[],
    displaySegments: null,
    agentWake: null,
    nextWake: null,
  }
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
  const parseTool = (t: Record<string, unknown>, fallbackId: string): CcToolEvent => ({
    name: String(t.name || '工具'),
    id: String(t.id || fallbackId),
    input: t.input,
    status:
      t.status === 'running' ||
      t.status === 'completed' ||
      t.status === 'error' ||
      t.status === 'denied'
        ? t.status
        : undefined,
    startedAt: typeof t.startedAt === 'number' ? t.startedAt : undefined,
    durationMs: typeof t.durationMs === 'number' ? t.durationMs : undefined,
    error: typeof t.error === 'string' ? t.error : undefined,
    result: typeof t.result === 'string' ? t.result : undefined,
  })
  const rawTools = Array.isArray(raw.tools) ? (raw.tools as Record<string, unknown>[]) : []
  const tools = rawTools.map((tool, index) => parseTool(tool, `t${index}`))
  const toolsById = new Map(tools.map(tool => [tool.id, tool]))
  const rawProcess = Array.isArray(raw.process)
    ? (raw.process as Record<string, unknown>[])
    : []
  const process = rawProcess.flatMap((item, index): CcProcessEvent[] => {
    if (item.type === 'thinking' && typeof item.text === 'string') {
      return [{
        type: 'thinking',
        id: String(item.id || `thinking-${index}`),
        text: item.text,
        startedAt: typeof item.startedAt === 'number' ? item.startedAt : undefined,
        durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
      }]
    }
    if (item.type === 'text' && typeof item.text === 'string') {
      return [{
        type: 'text',
        id: String(item.id || `text-${index}`),
        text: item.text,
      }]
    }
    if (item.type === 'tool' && item.tool && typeof item.tool === 'object') {
      const parsed = parseTool(item.tool as Record<string, unknown>, `process-tool-${index}`)
      return [{
        type: 'tool',
        id: String(item.id || `process-${parsed.id}`),
        tool: toolsById.get(parsed.id) || parsed,
      }]
    }
    if (item.type === 'compact') {
      const compaction = normalizeCompaction(item.compaction)
      return compaction ? [{ type: 'compact', id: String(item.id || compaction.id), compaction }] : []
    }
    return []
  })
  const displaySegments = normalizeDisplaySegments(raw.display_segments)
  const rawWake = raw.agent_wake && typeof raw.agent_wake === 'object'
    ? raw.agent_wake as Record<string, unknown>
    : null
  const rawNextWake = raw.next_wake && typeof raw.next_wake === 'object'
    ? raw.next_wake as Record<string, unknown>
    : null
  return {
    thinking: typeof raw.thinking === 'string' ? raw.thinking : '',
    tools,
    process,
    recall: normalizeRecall(raw.recall),
    // 5.2 起写库时带 usage。老消息没有 —— 那就不显示 token 面板，不编数字。
    usage: normalizeProviderUsage(raw.usage),
    // 被中断的半截回复。老消息没有这个字段 —— 一律不算中断。
    interrupted: raw.interrupted === true,
    interruptedReason: raw.interrupted_reason === 'pro_limit'
      ? 'pro_limit'
      : raw.interrupted === true
        ? 'user_stop'
        : undefined,
    engine: raw.engine === 'selfhost' ? 'selfhost' : raw.engine ? 'cc' : undefined,
    providerId: typeof raw.provider_id === 'string' ? raw.provider_id : '',
    providerLabel: typeof raw.provider_label === 'string' ? raw.provider_label : '',
    laneId: typeof raw.cc_lane_id === 'string' ? raw.cc_lane_id : '',
    model: typeof raw.model === 'string'
      ? raw.model
      : raw.settings && typeof raw.settings === 'object'
        ? String((raw.settings as Record<string, unknown>).model || '')
        : '',
    context: normalizeTurnContext(raw.context),
    contextSnapshot: normalizeContextSnapshot(raw.context_snapshot),
    cacheSnapshot: normalizeCacheSnapshot(raw.cache_snapshot),
    preCompactions: Array.isArray(raw.pre_compactions)
      ? raw.pre_compactions.flatMap(item => {
          const compaction = normalizeCompaction(item)
          return compaction ? [compaction] : []
        })
      : [],
    displaySegments: displaySegments?.segments || null,
    agentWake: rawWake
      ? {
          cause: String(rawWake.cause || 'cache_keepalive'),
          at: String(rawWake.at || ''),
          reason: String(rawWake.reason || '').trim() || undefined,
          status: String(rawWake.status || '').trim() || undefined,
        }
      : null,
    nextWake: rawNextWake && typeof rawNextWake.at === 'string' && rawNextWake.at
      ? { at: rawNextWake.at, reason: String(rawNextWake.reason || '') }
      : null,
  }
}

/**
 * 这个会话的 cc 是什么模式：只看 cc 轮次，自建轮次不能替 cc 锁模式。
 * 5.2 之前的老 cc 会话没 mode，算工作模式；从未用过 cc 则默认闲聊。
 */
export function modeOfTurns(turns: HavenTurnRow[]): CcMode {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const rawJson = turns[i]?.raw_json
    // 非常早的 cc 轮次连 raw 都没有，当时只有工作模式。
    if (!rawJson) return 'work'
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>
      if (parsed?.engine === 'selfhost') continue
      if (parsed?.mode === 'chat') return 'chat'
      if (parsed?.mode === 'work') return 'work'
      // selfhost 上线前的老轮次没有 engine / mode，当时只有 cc 工作模式。
      return 'work'
    } catch {
      /* 解不出来接着往前找 */
    }
  }
  return 'chat'
}

/**
 * 从历史最后一轮 raw 里取回「本窗配置」和 resume 接回点。
 *   · settings（第 4 条）：切回旧会话时右上角本窗口设置照它恢复
 *   · cc_session_id（第 5 条）：进程已丢时随下一句带回服务端，接上上下文
 * 老会话没这两个字段 —— 返回 null，界面就保持默认，不编数字。
 */
export function metaOfTurns(turns: HavenTurnRow[]): {
  settings: {
    cred?: string
    providerId?: string
    model?: string
    effort?: string
    thinkingOn?: boolean
    web?: CcWebSettings
  } | null
  ccSessionId: string
} {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const rawJson = turns[i]?.raw_json
    if (!rawJson) continue
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>
      const s = parsed?.settings as Record<string, unknown> | undefined
      const settings = s
        ? {
            cred: typeof s.cred === 'string' ? s.cred : undefined,
            providerId: typeof s.provider_id === 'string' ? s.provider_id : undefined,
            model: typeof s.model === 'string' ? s.model : undefined,
            effort: typeof s.effort === 'string' ? s.effort : undefined,
            thinkingOn: typeof s.thinking_on === 'boolean' ? s.thinking_on : undefined,
            web:
              s.web && typeof s.web === 'object'
                ? normalizeWebSettings(s.web as Record<string, unknown>)
                : undefined,
          }
        : null
      const ccSessionId = typeof parsed?.cc_session_id === 'string' ? parsed.cc_session_id : ''
      // 只要这轮带了任一新字段就用它；否则接着往前找老一点的轮
      if (settings || ccSessionId) return { settings, ccSessionId }
    } catch {
      /* 解不出来接着往前找 */
    }
  }
  return { settings: null, ccSessionId: '' }
}

export function turnsToMessages(turns: HavenTurnRow[]): CcMessage[] {
  const out: CcMessage[] = []
  for (const t of turns) {
    const at = Date.parse(t.created_at) || Date.now()
    const extra = parseTurnRaw(t.raw_json)
    for (const compaction of extra.preCompactions) {
      out.push({
        id: `h${t.id}c-${compaction.id}`,
        role: 'system',
        text: '',
        compaction,
        laneId: extra.laneId || undefined,
        createdAt: compaction.at || at,
        fromHistory: true,
      })
    }
    const wakeEvent: CcMessage | null = t.turn_kind === 'agent_wake' || extra.agentWake
      ? {
          id: `h${t.id}w`,
          role: 'system',
          text: '',
          wakeEvent: extra.agentWake || { cause: 'cache_keepalive', at: t.created_at },
          personaId: personaOfClient(t.client),
          thinking: !t.assistant_text?.trim() ? extra.thinking || undefined : undefined,
          thinkingMs: !t.assistant_text?.trim() ? thinkingDuration(extra.process) || undefined : undefined,
          usage: !t.assistant_text?.trim() ? extra.usage : undefined,
          createdAt: at,
          fromHistory: true,
          roundId: t.round_id,
        }
      : null
    if (wakeEvent) out.push(wakeEvent)
    const attachments: CcAttachment[] = (t.attachments || []).map(item => {
      const kind = item.kind === 'file' ? 'file' : 'image'
      return {
        id: item.id,
        sessionId: item.session_id,
        filename: item.filename,
        kind,
        mimeType: item.mime_type,
        byteSize: item.byte_size,
        sha256: item.sha256,
        textChars: item.text_chars || 0,
        textTruncated: item.text_truncated === true,
        cleared: item.cleared === true,
        previewUrl: item.cleared ? undefined : `/api/cc-attachments/${encodeURIComponent(item.id)}?session_id=${encodeURIComponent(item.session_id)}`,
      }
    })
    if (!wakeEvent && (t.user_text?.trim() || attachments.length > 0)) {
      out.push({
        id: `h${t.id}u`,
        role: 'user',
        text: t.user_text,
        attachments,
        createdAt: at,
        fromHistory: true,
      })
    }
    if (t.assistant_text?.trim() || extra.interruptedReason === 'pro_limit') {
      out.push({
        id: `h${t.id}a`,
        role: 'assistant',
        text: t.assistant_text,
        createdAt: at,
        fromHistory: true,
        personaId: personaOfClient(t.client),
        thinking: extra.thinking || undefined,
        tools: extra.tools.length ? extra.tools : undefined,
        process: extra.process.length ? extra.process : undefined,
        recall: extra.recall,
        usage: extra.usage,
        interrupted: extra.interrupted || undefined,
        interruptedReason: extra.interruptedReason,
        engine: extra.engine || (t.source === 'selfhost' ? 'selfhost' : t.source === 'cc' ? 'cc' : undefined),
        providerId: extra.providerId || undefined,
        providerLabel: extra.providerLabel || undefined,
        laneId: extra.laneId || undefined,
        model: extra.model || undefined,
        context: extra.context,
        contextSnapshot: extra.contextSnapshot,
        cacheSnapshot: extra.cacheSnapshot || (t.source === 'cc'
          ? {
              // 旧轮次还没有 cache_snapshot；Haven 写入时间只比模型 result 晚几秒，
              // 可作为一次性兼容基线。过期后照常长期显示“已过期”，不再整项消失。
              refreshedAt: at,
              systemTtlMs: 60 * 60 * 1000,
              sessionTtlMs: 5 * 60 * 1000,
              model: extra.model,
            }
          : null),
        roundId: t.round_id,
        deliveryState: 'saved',
        deliveryNote: extra.interruptedReason === 'pro_limit'
          ? t.assistant_text?.trim()
            ? 'Pro 额度中断；已生成内容和用户消息均已保存到 Haven'
            : 'Pro 额度不足，未生成回复；用户消息已保存到 Haven'
          : undefined,
        displaySegments: extra.displaySegments || buildDisplaySegments(t.assistant_text).segments,
        nextWake: extra.nextWake || undefined,
      })
    } else if (wakeEvent && extra.nextWake) {
      wakeEvent.nextWake = extra.nextWake
    }
  }
  return out
}
