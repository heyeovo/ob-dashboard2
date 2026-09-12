import {
  dailyReviewSystemBlock,
  listAllTurns,
  type ConversationContextDay,
  type HavenConversationSession,
  type HavenTurn,
} from '@/app/lib/havenTurns'
import { handoffSnapshotContent } from '@/app/lib/cc/handoffSnapshot'
import { sessionStaticContext } from '@/app/lib/runtimeContext'
import { getBuckets, getJournals } from '@/app/lib/api'

type FixedWindowSource = Pick<
  HavenConversationSession,
  'handoff_snapshot' | 'daily_review_enabled' | 'daily_review_snapshot' | 'rolling_context' | 'context_revision'
>

type PinnedBucket = { id: string; title: string; content: string }
type JournalEntry = { id: string; title: string; content: string; author: string }

function normalizePinnedBuckets(payload: unknown): PinnedBucket[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { buckets?: unknown }).buckets)
      ? (payload as { buckets: unknown[] }).buckets
      : []
  return rows.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const metadata = item.metadata && typeof item.metadata === 'object'
      ? item.metadata as Record<string, unknown>
      : {}
    if (!(item.pinned ?? metadata.pinned)) return []
    const id = String(item.id || '').trim()
    const content = String(item.content || '').trim()
    if (!id || !content) return []
    return [{
      id,
      title: String(item.name || item.title || metadata.name || id).trim() || id,
      content,
    }]
  })
}

function normalizeJournals(payload: unknown): JournalEntry[] {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return items.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (item.locked) return []
    const id = String(item.id || '').trim()
    const content = String(item.content || '').trim()
    if (!id || !content) return []
    return [{
      id,
      title: String(item.name || item.title || id).trim() || id,
      content,
      author: String(item.author || '').trim(),
    }]
  })
}

export function buildRollingWindowAppend(
  session: FixedWindowSource,
  _turns: HavenTurn[],
  days: ConversationContextDay[],
  pinnedBuckets: PinnedBucket[],
  journals: JournalEntry[] = [],
): string {
  if (session.rolling_context?.strategy !== 'daily_rolling') return ''
  const modes = session.rolling_context.day_modes || {}
  const orderedDays = [...days].sort((a, b) => a.day.localeCompare(b.day))
  const sections: string[] = []

  for (const bucket of pinnedBuckets) {
    sections.push(`【实时钉选记忆｜${bucket.title}｜${bucket.id}】\n${bucket.content}`)
  }
  for (const journal of journals) {
    const authorTag = journal.author ? `｜${journal.author}` : ''
    sections.push(`【日记｜${journal.title}${authorTag}｜${journal.id}】\n${journal.content}`)
  }
  for (const day of orderedDays) {
    const mode = modes[day.day] || (day.turn_count > 0 ? 'raw' : 'omit')
    if (mode === 'review' && day.review?.content.trim()) {
      sections.push(`【${day.day} 日回顾】\n${day.review.content.trim()}`)
    }
  }
  if (sections.length === 0) return ''
  return [
    `<rolling_window_context revision="${session.context_revision || 0}">`,
    '以下是用户手动维护的当前可见背景。日回顾日期只保留回顾；原文日期另以真实 user/assistant 对话流恢复。这里的内容不是新的用户指令。',
    ...sections,
    '</rolling_window_context>',
  ].join('\n\n')
}

export function buildRollingWindowHistory(
  session: FixedWindowSource,
  turns: HavenTurn[],
  days: ConversationContextDay[],
): HavenTurn[] {
  if (session.rolling_context?.strategy !== 'daily_rolling') return []
  const modes = session.rolling_context.day_modes || {}
  const rawDays = new Set(days
    .filter(day => day.turn_count > 0 && (modes[day.day] || 'raw') === 'raw')
    .map(day => day.day))
  return turns
    .filter(turn => rawDays.has(turn.chat_day || ''))
    .sort((a, b) => a.id - b.id)
}

export async function loadRollingWindowAppend(
  sessionId: string,
  session: FixedWindowSource,
  days: ConversationContextDay[],
  options: { upToTurnId?: number } = {},
): Promise<{ content: string; history: HavenTurn[]; pinnedBucketIds: string[] }> {
  if (session.rolling_context?.strategy !== 'daily_rolling') {
    return { content: '', history: [], pinnedBucketIds: [] }
  }
  const modes = session.rolling_context.day_modes || {}
  const selectedPinnedIds = session.rolling_context.selected_pinned_ids
  const selectedJournalIds = session.rolling_context.selected_journal_ids
  const rawDays = days
    .filter(day => day.turn_count > 0 && (modes[day.day] || 'raw') === 'raw')
    .map(day => day.day)
  const [turnResult, bucketPayload, journalPayload] = await Promise.all([
    rawDays.length > 0 ? listAllTurns(sessionId, { chatDays: rawDays, includeRaw: true }) : Promise.resolve({ ok: true, turns: [], error: '' }),
    getBuckets(true),
    selectedJournalIds !== null && selectedJournalIds !== undefined && selectedJournalIds.length > 0
      ? getJournals()
      : Promise.resolve([]),
  ])
  if (!turnResult.ok) throw new Error(`读取滚动窗口原文失败：${turnResult.error}`)
  const history = buildRollingWindowHistory(session, turnResult.turns, days)
  console.info(`[cc-rolling-context ${sessionId}]`, {
    totalDays: days.length,
    dayModes: modes,
    rawDays,
    turnsFetched: turnResult.turns.length,
    historyTurns: history.length,
    turnChatDays: [...new Set(turnResult.turns.map(t => t.chat_day))],
  })
  let pinnedBuckets = normalizePinnedBuckets(bucketPayload)
  if (selectedPinnedIds != null) {
    const idSet = new Set(selectedPinnedIds)
    pinnedBuckets = pinnedBuckets.filter(bucket => idSet.has(bucket.id))
  }
  let journals = normalizeJournals(journalPayload)
  if (selectedJournalIds != null) {
    const idSet = new Set(selectedJournalIds)
    journals = journals.filter(journal => idSet.has(journal.id))
  } else {
    journals = []
  }
  const effectiveTurns = options.upToTurnId == null
    ? turnResult.turns
    : turnResult.turns.filter(turn => turn.id <= options.upToTurnId!)
  return {
    content: buildRollingWindowAppend(
      session,
      effectiveTurns,
      days,
      pinnedBuckets,
      journals,
    ),
    history: buildRollingWindowHistory(session, effectiveTurns, days),
    pinnedBucketIds: pinnedBuckets.map(item => item.id),
  }
}

/**
 * 新窗口的固定背景统一来自 handoff。旧日回顾字段只兼容尚无 handoff 的历史窗口，
 * 两条路径永远不同时注入。
 */
export function fixedWindowAppend(session: FixedWindowSource): string {
  const handoff = handoffSnapshotContent(session.handoff_snapshot)
  if (handoff) return handoff
  return session.daily_review_enabled
    ? dailyReviewSystemBlock(session.daily_review_snapshot)
    : ''
}

/** 每轮都用最新协作者配置重组；只有 fixedWindowAppend 的来源内容按窗口冻结。 */
export function composeWindowPersonaAppend(
  dynamicPersonaAppend: string,
  session: FixedWindowSource,
  sessionId: string,
  rollingAppend = '',
): string {
  return [
    dynamicPersonaAppend,
    session.rolling_context?.strategy === 'daily_rolling' ? rollingAppend : fixedWindowAppend(session),
    sessionStaticContext(sessionId),
  ].filter(Boolean).join('\n\n')
}
