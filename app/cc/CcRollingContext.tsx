'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ConversationContextDay,
  HavenConversationSession,
  RollingContextConfig,
} from '@/app/lib/havenTurns'
import { contextParts, currentDayMode, dayParts, formatContextTokens as fmt, sumParts, type DayReceipt } from '@/app/lib/cc/rollingContextEstimate'
import { estimateHandoffTokens } from '@/app/lib/cc/handoffSnapshot'

type Props = {
  sessionId: string
  personaId: string
  busy: boolean
}

type Candidate = {
  id: string
  title: string
  content: string
  note?: string
  created?: string
  importance?: number
  badge?: string
}

type BucketCandidate = Candidate & {
  pinned: boolean
  archived: boolean
  noise: boolean
  resolved: boolean
  digested: boolean
  feel: boolean
  journal: boolean
}

function defaultModes(days: ConversationContextDay[]): Record<string, 'raw' | 'review' | 'omit'> {
  const newest = [...days].sort((a, b) => b.day.localeCompare(a.day))
  let rawDays = 0
  let reviewDays = 0
  return Object.fromEntries(newest.map(day => {
    if (day.turn_count > 0 && rawDays < 3) {
      rawDays += 1
      return [day.day, 'raw']
    }
    if (day.review && reviewDays < 10) {
      reviewDays += 1
      return [day.day, 'review']
    }
    return [day.day, 'omit']
  }))
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function includeSelected(visible: Candidate[], all: Candidate[], selected: Set<string>): Candidate[] {
  const visibleIds = new Set(visible.map(item => item.id))
  return [...visible, ...all.filter(item => selected.has(item.id) && !visibleIds.has(item.id))]
}

function latestConversationDay(days: ConversationContextDay[]): string {
  return days
    .filter(day => day.turn_count > 0)
    .map(day => day.day)
    .sort((a, b) => b.localeCompare(a))[0] || ''
}

function shuffled<T>(items: T[], seed: number): T[] {
  const next = [...items]
  let value = seed || 1
  for (let index = next.length - 1; index > 0; index -= 1) {
    value = (value * 1664525 + 1013904223) >>> 0
    const target = value % (index + 1)
    ;[next[index], next[target]] = [next[target], next[index]]
  }
  return next
}

function LimitControl({ value, unit, onChange, random = false }: { value: number; unit: string; onChange: (value: number) => void; random?: boolean }) {
  return (
    <label className="flex items-center gap-1 text-2xs text-[var(--color-text-disabled)]">
      {random ? '' : '最近'}
      <input type="number" min={0} value={value} onChange={event => onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)))} className="rolling-num min-h-11" />
      {unit}
    </label>
  )
}

function SelectionSection({
  title,
  hint,
  items,
  selected,
  open,
  onToggleOpen,
  onToggle,
  onAll,
  onNone,
  control,
}: {
  title: string
  hint: string
  items: Candidate[]
  selected: Set<string>
  open: boolean
  onToggleOpen: () => void
  onToggle: (id: string) => void
  onAll: () => void
  onNone: () => void
  control?: React.ReactNode
}) {
  const selectedCount = items.filter(item => selected.has(item.id)).length
  return (
    <section className="border-t border-[var(--color-border-light)] first:border-t-0">
      <button type="button" onClick={onToggleOpen} className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-meta font-medium text-[var(--color-text-heading)]">{title}</span>
          <span className="mt-0.5 block text-3xs text-[var(--color-text-disabled)]">
            已选 {selectedCount}/{items.length} · {fmt(items.filter(item => selected.has(item.id)).reduce((sum, item) => sum + estimateHandoffTokens(item.content), 0))}
          </span>
        </span>
        <span className="text-2xs text-[var(--color-text-disabled)]">{open ? '⌄' : '›'}</span>
      </button>
      {open ? (
        <div className="border-t border-[var(--color-border-light)] px-3 pb-2.5 pt-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-2xs">
            <div>{control || hint}</div>
            {items.length > 0 ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={onAll} className="min-h-11 text-[var(--color-primary)]">全选</button>
                <span className="text-[var(--color-border)]">|</span>
                <button type="button" onClick={onNone} className="min-h-11 text-[var(--color-primary)]">全不选</button>
              </div>
            ) : null}
          </div>
          {items.length === 0 ? (
            <div className="py-2 text-center text-2xs text-[var(--color-text-disabled)]">暂无可选内容</div>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {items.map(item => (
                <label key={item.id} className={`flex min-h-11 cursor-pointer items-center gap-2 border-t border-[var(--color-border-light)] px-1 py-1.5 `}>
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {item.badge ? <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] px-1.5 py-0.5 text-3xs text-[var(--color-primary)]">{item.badge}</span> : null}
                      <span className="block truncate text-meta text-[var(--color-text-secondary)]">{item.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between text-3xs text-[var(--color-text-disabled)]">
                      <span>{item.note ? `${item.note} · ` : ''}{fmt(estimateHandoffTokens(item.content))}</span>
                      {item.created ? <span className="shrink-0 pl-2">{item.created.slice(0, 10)}</span> : null}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

export default function CcRollingContext({ sessionId, personaId, busy }: Props) {
  const [openedAt] = useState(() => Date.now())
  const [session, setSession] = useState<HavenConversationSession | null>(null)
  const [days, setDays] = useState<ConversationContextDay[]>([])
  const [draft, setDraft] = useState<RollingContextConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [note, setNote] = useState('')
  const [pinnedItems, setPinnedItems] = useState<Candidate[]>([])
  const [journalItems, setJournalItems] = useState<Candidate[]>([])
  const [recentItems, setRecentItems] = useState<Candidate[]>([])
  const [feelItems, setFeelItems] = useState<Candidate[]>([])
  const [highImportanceItems, setHighImportanceItems] = useState<Candidate[]>([])
  const [selectedPinned, setSelectedPinned] = useState<Set<string>>(new Set())
  const [selectedJournals, setSelectedJournals] = useState<Set<string>>(new Set())
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(new Set())
  const [selectedFeels, setSelectedFeels] = useState<Set<string>>(new Set())
  const [selectedRandomHighImportance, setSelectedRandomHighImportance] = useState<Set<string>>(new Set())
  const [journalLimit, setJournalLimit] = useState(10)
  const [recentLimit, setRecentLimit] = useState(10)
  const [feelLimit, setFeelLimit] = useState(20)
  const [randomHighImportanceLimit, setRandomHighImportanceLimit] = useState(10)
  const [randomBatch, setRandomBatch] = useState(() => Date.now())
  const [savedSelection, setSavedSelection] = useState('')
  const [pane, setPane] = useState('days')
  const [receipts, setReceipts] = useState<DayReceipt[] | null>(null)
  const [receiptRevision, setReceiptRevision] = useState<number | null>(null)
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) setLoading(true) })
    Promise.all([
      fetch(`/api/cc-turns?session_id=${encodeURIComponent(sessionId)}&limit=1&context_days=1`, { cache: 'no-store' }),
      fetch('/api/buckets?full=1', { cache: 'no-store' }),
      fetch('/api/journal', { cache: 'no-store' }),
      fetch(`/api/cc-rolling-state?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ])
      .then(async ([turnsRes, bucketsRes, journalRes, stateData]) => {
        const [turnsData, bucketsData, journalData] = await Promise.all([
          turnsRes.json(),
          bucketsRes.json(),
          journalRes.json(),
        ])
        if (!turnsRes.ok || !turnsData.ok || !turnsData.session) throw new Error(turnsData.error || '读取失败')
        if (cancelled) return

        setReceipts(Array.isArray(stateData?.days) ? stateData.days : null)
        setReceiptRevision(stateData?.revision ?? null)
        setSession(turnsData.session)
        setDays(Array.isArray(turnsData.context_days) ? turnsData.context_days : [])
        const rollingContext: RollingContextConfig = turnsData.session.rolling_context
        setDraft(rollingContext)

        const rawBuckets = Array.isArray(bucketsData) ? bucketsData : (bucketsData?.buckets || [])
        const buckets: BucketCandidate[] = rawBuckets.flatMap((b: Record<string, unknown>) => {
          const metadata = b?.metadata && typeof b.metadata === 'object'
            ? b.metadata as Record<string, unknown>
            : {}
          const id = String(b?.id || '').trim()
          const content = String(b?.content || '').trim()
          if (!id || !content) return []
          const type = String(b.type || metadata.type || '').toLowerCase()
          const tags = Array.isArray(b.tags || metadata.tags) ? (b.tags || metadata.tags) as unknown[] : []
          const domains = Array.isArray(b.domain || metadata.domain) ? (b.domain || metadata.domain) as unknown[] : []
          const hasMarker = (value: string) => tags.some(tag => String(tag).toLowerCase() === value)
            || domains.some(domain => String(domain).toLowerCase() === value)
          return [{
            id,
            title: String(b.name || b.title || metadata.name || id),
            content,
            created: String(b.event_time || b.created || metadata.event_time || metadata.created || ''),
            importance: Number(b.importance ?? metadata.importance ?? 0),
            pinned: Boolean(b.pinned ?? metadata.pinned),
            archived: type === 'archived' || type === 'archive' || Boolean(b.archived ?? metadata.archived),
            noise: type === 'noise' || Boolean(b.noise ?? metadata.noise) || hasMarker('noise'),
            resolved: Boolean(b.resolved ?? metadata.resolved),
            digested: Boolean(b.digested ?? metadata.digested),
            feel: type === 'feel' || hasMarker('feel') || hasMarker('沉淀物'),
            journal: type === 'journal',
          }]
        })
        const pinned: Candidate[] = buckets.filter(bucket => bucket.pinned && !bucket.feel)
        setPinnedItems(pinned)

        const eligible = buckets.filter(bucket => !bucket.archived && !bucket.noise
          && !bucket.resolved && !bucket.digested && !bucket.journal
          && (!bucket.pinned || bucket.feel))
        const recent = eligible.filter(bucket => !bucket.feel)
          .sort((a, b) => String(b.created).localeCompare(String(a.created)))
        const feels = eligible.filter(bucket => bucket.feel)
          .sort((a, b) => String(b.created).localeCompare(String(a.created)))
        setRecentItems(recent)
        setFeelItems(feels)
        setHighImportanceItems(recent.filter(bucket => Number(bucket.importance) >= 7))

        const savedPinnedIds = rollingContext.selected_pinned_ids
        setSelectedPinned(
          savedPinnedIds != null
            ? new Set(savedPinnedIds)
            : new Set(pinned.map(item => item.id)),
        )
        setSelectedRecent(new Set(rollingContext.selected_recent_ids || []))
        setSelectedFeels(new Set([
          ...(rollingContext.selected_feel_ids || []),
          ...feels.filter(item => item.pinned).map(item => item.id),
        ]))
        setSelectedRandomHighImportance(new Set(rollingContext.selected_random_high_importance_ids || []))

        const rawJournals = Array.isArray(journalData) ? journalData : (journalData?.items || [])
        const journals: Candidate[] = rawJournals
          .filter((j: Record<string, unknown>) => !j?.locked && String(j?.content || '').trim())
          .map((j: Record<string, unknown>): Candidate => ({
            id: String(j.id),
            title: String(j.name || j.title || j.id),
            content: String(j.content || ''),
            note: String(j.author || ''),
            created: String(j.event_time || j.created || ''),
          }))
          .sort((a: Candidate, b: Candidate) => String(b.created).localeCompare(String(a.created)))
        setJournalItems(journals)

        const savedJournalIds = rollingContext.selected_journal_ids
        setSelectedJournals(savedJournalIds != null ? new Set(savedJournalIds) : new Set())
        setSavedSelection(JSON.stringify([
          [...(savedPinnedIds ?? pinned.map(item => item.id))].sort(), [...(savedJournalIds || [])].sort(),
          [...(rollingContext.selected_recent_ids || [])].sort(),
          [...new Set([...(rollingContext.selected_feel_ids || []), ...feels.filter(item => item.pinned).map(item => item.id)])].sort(),
          [...(rollingContext.selected_random_high_importance_ids || [])].sort(),
        ]))
      })
      .catch(error => { if (!cancelled) setNote(error instanceof Error ? error.message : '读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const journalVisible = useMemo(
    () => includeSelected(journalItems.slice(0, journalLimit), journalItems, selectedJournals),
    [journalItems, journalLimit, selectedJournals],
  )
  const recentBase = useMemo(() => recentItems.slice(0, recentLimit), [recentItems, recentLimit])
  const recentVisible = useMemo(
    () => includeSelected(recentBase, recentItems, selectedRecent),
    [recentBase, recentItems, selectedRecent],
  )
  const feelVisible = useMemo(
    () => includeSelected(feelItems.slice(0, feelLimit), feelItems, selectedFeels),
    [feelItems, feelLimit, selectedFeels],
  )
  const randomHighImportancePool = useMemo(() => {
    const recentIds = new Set(recentBase.map(item => item.id))
    return highImportanceItems.filter(item => !recentIds.has(item.id))
  }, [highImportanceItems, recentBase])
  const randomHighImportanceVisible = useMemo(() => {
    const batch = shuffled(randomHighImportancePool, randomBatch).slice(0, randomHighImportanceLimit)
    return includeSelected(batch, highImportanceItems, selectedRandomHighImportance)
  }, [highImportanceItems, randomBatch, randomHighImportanceLimit, randomHighImportancePool, selectedRandomHighImportance])

  const draftLongTokens = useMemo(() => {
    const selectedBuckets = new Map<string, Candidate>()
    for (const [items, selected] of [
      [pinnedItems, selectedPinned],
      [recentItems, selectedRecent],
      [feelItems, selectedFeels],
      [highImportanceItems, selectedRandomHighImportance],
    ] as Array<[Candidate[], Set<string>]>) {
      for (const item of items) if (selected.has(item.id)) selectedBuckets.set(item.id, item)
    }
    const longTermTokens = [...selectedBuckets.values(), ...journalItems.filter(item => selectedJournals.has(item.id))]
      .reduce((total, item) => total + estimateHandoffTokens(item.content), 0)
    return longTermTokens
  }, [feelItems, highImportanceItems, journalItems, pinnedItems, recentItems, selectedFeels, selectedJournals, selectedPinned, selectedRandomHighImportance, selectedRecent])

  if (loading) return <div className="py-8 text-center text-base text-[var(--color-text-disabled)]">读取上下文日期…</div>
  if (!draft || !session) return <div className="text-meta text-[var(--color-primary)]">{note || '没有可用的窗口配置'}</div>

  const updateStrategy = (strategy: RollingContextConfig['strategy']) => {
    setDraft(current => current ? {
      ...current,
      strategy,
      day_modes: strategy === 'daily_rolling' && Object.keys(current.day_modes || {}).length === 0
        ? defaultModes(days)
        : current.day_modes,
    } : current)
    setNote('')
  }

  const save = async () => {
    if (busy) return
    const switchingToFixed = session.rolling_context?.strategy === 'daily_rolling'
      && draft.strategy === 'fixed_window'
    if (switchingToFixed && !window.confirm(
      '切回原换窗机制后，这个窗口只会使用创建时冻结的旧换窗资料，滚动期间的新对话不会自动带入。\n\n如果要保留最新衔接，请取消并先使用“换窗继续”。仍要直接切回吗？',
    )) return
    setSaving(true)
    setNote('')
    try {
      const rollingContext = {
        rebuild_revision: draft.strategy === 'daily_rolling' && days.some(needsDayRebuild),
        strategy: draft.strategy,
        timezone: draft.timezone,
        day_start_hour: draft.day_start_hour,
        day_modes: draft.day_modes,
        selected_pinned_ids: [...selectedPinned],
        selected_journal_ids: [...selectedJournals],
        selected_recent_ids: [...selectedRecent],
        selected_feel_ids: [...selectedFeels],
        selected_random_high_importance_ids: [...selectedRandomHighImportance],
      }
      const response = await fetch('/api/cc-turns', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          persona_id: personaId,
          expected_state_version: session.state_version,
          rolling_context: rollingContext,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok || !data.session) throw new Error(data.error || '保存失败')
      setSession(data.session)
      setDraft(data.session.rolling_context)
      setSavedSelection(selectionSignature)
      setReceipts(null)
      setReceiptRevision(null)
      setNote(`已保存 · 版本 ${data.session.context_revision}。下一句话会使用这份上下文。`)
    } catch (error) {
      setNote(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const recoverFromHavenBody = async () => {
    if (busy || saving || recovering) return
    if (!window.confirm(
      '这会永久停止使用当前损坏的 Claude transcript，并用 Haven 中成功保存的用户/助手正文创建全新 transcript。\n\n旧 transcript 里的工具调用、工具结果、动态召回、图片、thinking，以及未成功写入 Haven 的失败消息和失败主动唤醒不会进入新 transcript。页面聊天历史、日回顾和窗口设置不会删除。\n\n确定继续吗？',
    )) return
    setRecovering(true)
    setNote('正在生成并切换新的正文 transcript…')
    try {
      const response = await fetch('/api/cc-rolling-recovery', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          persona_id: personaId,
          expected_state_version: session.state_version,
          confirm: sessionId,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok || !data.session) throw new Error(data.error || '正文重建失败')
      setSession(data.session)
      setDraft(data.session.rolling_context)
      setNote(`已从 Haven 正文重建 · ${Number(data.turn_count || 0).toLocaleString()} 轮、${Number(data.entry_count || 0).toLocaleString()} 条 transcript 记录。现在可以继续对话。`)
    } catch (error) {
      setNote(error instanceof Error ? error.message : '正文重建失败')
    } finally {
      setRecovering(false)
    }
  }

  const toggleSection = (id: string) => setOpenSections(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const modeForDay = (day: ConversationContextDay) => draft.day_modes?.[day.day] || 'raw'
  const latestDay = latestConversationDay(days)
  const sortedDays = [...days].sort((a, b) => b.day.localeCompare(a.day))
  const includedDays = sortedDays.filter(day => modeForDay(day) !== 'omit')
  const omittedDays = sortedDays.filter(day => modeForDay(day) === 'omit')
  const actualReceipts = receiptRevision === session.context_revision ? receipts : null
  const receiptFor = (day: string) => actualReceipts?.find(row => row.day === day)
  const revisionLastDay = actualReceipts?.map(row => row.day).sort().at(-1)
  const actualMode = (day: ConversationContextDay) => currentDayMode(day.day, session.rolling_context, receiptFor(day.day), day.turn_count > 0 ? revisionLastDay : undefined)
  const currentParts = (day: ConversationContextDay) => dayParts(day, actualMode(day), receiptFor(day.day) || null,
    !actualReceipts && day.day !== latestDay)
  const nextParts = (day: ConversationContextDay) => dayParts(day, modeForDay(day), null, day.day !== latestDay)
  const needsDayRebuild = (day: ConversationContextDay) => {
    const now = currentParts(day)
    const next = nextParts(day)
    return contextParts.some(key => now[key] !== next[key])
      || (actualMode(day) === 'raw' && modeForDay(day) === 'raw' && day.day !== latestDay
        && receiptFor(day.day)?.treatment === 'full')
  }
  const currentTotals = Object.fromEntries(contextParts.map(key => [key, days.reduce((sum, day) => sum + currentParts(day)[key], 0)]))
  const currentDateTokens = days.reduce((sum, day) => sum + sumParts(currentParts(day)), 0)
  const nextDateTokens = days.reduce((sum, day) => sum + sumParts(nextParts(day)), 0)
  const bucketGroups: Array<[Candidate[], string[] | null | undefined]> = [
    [pinnedItems, session.rolling_context.selected_pinned_ids ?? pinnedItems.map(item => item.id)],
    [recentItems, session.rolling_context.selected_recent_ids], [feelItems, session.rolling_context.selected_feel_ids],
    [highImportanceItems, session.rolling_context.selected_random_high_importance_ids],
  ]
  const currentBuckets = new Map<string, Candidate>()
  for (const [items, ids] of bucketGroups) for (const item of items) if (ids?.includes(item.id)) currentBuckets.set(item.id, item)
  if (session.rolling_context.pinned_snapshot) {
    for (const item of pinnedItems) if (session.rolling_context.selected_pinned_ids?.includes(item.id)) currentBuckets.delete(item.id)
    for (const item of session.rolling_context.pinned_snapshot) currentBuckets.set(item.id, item)
  }
  const currentLongTokens = [...currentBuckets.values(), ...journalItems.filter(item => session.rolling_context.selected_journal_ids?.includes(item.id))]
    .reduce((sum, item) => sum + estimateHandoffTokens(item.content), 0)
  const currentTotal = currentDateTokens + currentLongTokens
  const difference = nextDateTokens + draftLongTokens - currentTotal
  const selectionSignature = JSON.stringify([selectedPinned, selectedJournals, selectedRecent, selectedFeels, selectedRandomHighImportance].map(ids => [...ids].sort()))
  const pinnedChanged = session.rolling_context.pinned_snapshot != null && JSON.stringify(session.rolling_context.pinned_snapshot)
    !== JSON.stringify(pinnedItems.filter(item => selectedPinned.has(item.id)).map(({ id, title, content }) => ({ id, title, content })))
  const dirty = selectionSignature !== savedSelection || pinnedChanged
    || draft.strategy !== session.rolling_context.strategy || draft.day_start_hour !== session.rolling_context.day_start_hour
    || JSON.stringify(draft.day_modes) !== JSON.stringify(session.rolling_context.day_modes)
    || (draft.strategy === 'daily_rolling' && (difference !== 0 || days.some(needsDayRebuild)))
  const labels = ['正文', 'thinking', '工具', '附件', '召回', '其他', '长期层']
  const totals = [...contextParts.map(key => currentTotals[key]), currentLongTokens]
  const statusFor = (day: ConversationContextDay) => {
    if (!actualReceipts) return ''
    const receipt = receiptFor(day.day)
    const state = receipt?.treatment
    const status = state === 'removed' || !receipt && actualMode(day) !== 'raw' ? (actualMode(day) === 'review' ? '日回顾' : '不带')
      : state === 'pruned' ? '已精简' : state === 'body_restored' ? '正文恢复' : '完整'
    if (modeForDay(day) !== actualMode(day)) return `${status} · 保存后${modeForDay(day) === 'omit' ? '不带' : modeForDay(day) === 'review' ? '日回顾' : '恢复原文'}`
    if (needsDayRebuild(day)) return `${status} · ${nextParts(day).thinking > currentParts(day).thinking ? '保存后恢复 thinking' : '保存后精简'}`
    return status
  }
  const renderDay = (day: ConversationContextDay) => {
    const mode = modeForDay(day)
    const now = currentParts(day)
    const next = nextParts(day)
    const full = dayParts(day, 'raw', null, false)
    const imageTokens = day.token_estimate?.attachment_image_tokens || 0
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(`${day.day}T12:00:00+08:00`))
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: draft.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(openedAt - draft.day_start_hour * 3600000))
    return <div key={day.day} className="border-t border-[var(--color-border-light)] first:border-t-0">
      <div className="flex min-h-11 items-center gap-1 pl-3 pr-1">
        <button type="button" className="min-w-0 flex-1 self-stretch py-1.5 text-left" onClick={() => toggleSection(day.day)} aria-expanded={openSections.has(day.day)}>
          <span className="text-xs text-[var(--color-text-primary)]">{day.day}<small className="ml-1.5 text-2xs text-[var(--color-text-tertiary)]">{weekday}{day.day === today ? ' · 今天' : ''}</small></span>
          <span className="mt-0.5 block text-2xs tabular-nums text-[var(--color-text-tertiary)]">{day.turn_count} 轮 · {fmt(sumParts(now))}{statusFor(day) ? ` · ${statusFor(day)}` : ''}</span>
        </button>
        <select aria-label={`${day.day} 内容方式`} className="rolling-select min-h-11" value={mode}
          onChange={event => setDraft({ ...draft, day_modes: { ...draft.day_modes, [day.day]: event.target.value as 'raw' | 'review' | 'omit' } })}>
          <option value="raw">原文</option><option value="review" disabled={!day.review}>日回顾</option><option value="omit">不带</option>
        </select>
        <button type="button" aria-label={`展开 ${day.day}`} aria-expanded={openSections.has(day.day)} className="min-h-11 w-6 shrink-0 text-meta text-[var(--color-text-disabled)]" onClick={() => toggleSection(day.day)}>{openSections.has(day.day) ? '⌄' : '›'}</button>
      </div>
      {openSections.has(day.day) ? <div className="px-3 pb-3">
        {mode === 'review' ? <div className="whitespace-pre-wrap text-meta leading-relaxed text-[var(--color-text-secondary)]">{day.review?.content}</div>
          : <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-2xs">{contextParts.map((key, index) => {
            const cut = full[key] > now[key]
            const will = next[key] !== now[key]
            const value = key === 'attachments' && imageTokens ? imageTokens : full[key]
            return <div key={key} className="flex justify-between gap-1 text-[var(--color-text-tertiary)]"><span>{key === 'attachments' && imageTokens ? '图片' : labels[index]}</span>
              <span className={cut ? 'text-[var(--color-text-disabled)] line-through' : will ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'}>{fmt(value)}</span></div>
          })}</div>}
      </div> : null}
    </div>
  }
  const group = 'overflow-hidden rounded-[var(--radius-lg)] bg-[var(--rolling-group-fill)]'
  return <div className="space-y-3">
    <div className="px-1">
      <div className="flex items-center justify-between gap-2">
        <div>{draft.strategy === 'daily_rolling' ? <><div className="text-2xs text-[var(--color-text-tertiary)]">下一轮会带上</div>
          <span className="text-lg tabular-nums text-[var(--color-text-primary)]">{fmt(currentTotal)}</span>
          {difference ? <span className="ml-2 text-2xs text-[var(--color-primary)]">保存后 {difference > 0 ? '+' : '−'}{fmt(Math.abs(difference))}</span> : null}</> : <span className="text-xs text-[var(--color-text-secondary)]">原换窗机制</span>}</div>
        <button type="button" disabled={saving || busy || !dirty} onClick={() => void save()} className="group min-h-11 shrink-0 pl-2"><span className="block rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3.5 py-1.5 text-meta text-[var(--color-on-primary)] group-disabled:opacity-40">{saving ? '保存中…' : busy ? '回复结束后可保存' : '保存'}</span></button>
      </div>
      {draft.strategy === 'daily_rolling' ? <>
        <div className="mt-3 flex h-1 gap-0.5 overflow-hidden rounded-[var(--radius-sm)]">{totals.map((value, index) => value > 0 ? <i key={index} style={{ flex: value, background: `var(--rolling-part-${index})` }} /> : null)}</div>
        <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3">{labels.map((label, index) => <div key={label}><div className="flex items-center gap-1 text-3xs text-[var(--color-text-tertiary)]"><i className="h-1.5 w-1.5 rounded-[var(--radius-sm)]" style={{ background: `var(--rolling-part-${index})` }} />{label}</div><div className="mt-0.5 pl-2.5 text-meta tabular-nums text-[var(--color-text-secondary)]">{fmt(totals[index])}</div></div>)}</div>
        <div className={`mt-3 text-2xs ${currentTotal > 100000 ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>不含系统提示词和每轮动态召回{currentTotal > 100000 ? ' · 超过 100.0k，建议精简' : ''}</div>
      </> : null}
    </div>
    {draft.strategy === 'daily_rolling' ? <nav className="flex gap-0.5 rounded-[var(--radius-md)] bg-[var(--rolling-group-fill)] p-0.5" aria-label="拼接内容">
      {['days', 'long', 'settings'].map((id, index) => <button type="button" key={id} onClick={() => setPane(id)} className={`min-h-11 min-w-0 flex-1 rounded-[var(--radius-sm)] text-meta ${pane === id ? 'bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--color-text-tertiary)]'}`}>
        {['日期内容', '长期层', '设置'][index]}{index < 2 ? <small className="ml-1 text-2xs text-[var(--color-text-disabled)]">{fmt(index === 0 ? currentDateTokens : currentLongTokens)}</small> : null}
      </button>)}
    </nav> : null}
    {draft.strategy === 'daily_rolling' && pane === 'days' ? <>
      <div className={group}>{includedDays.map(renderDay)}</div>
      {omittedDays.length ? <><button type="button" onClick={() => toggleSection('omitted-days')} className="min-h-11 w-full px-1 text-left text-meta text-[var(--color-text-tertiary)]">不带的日期 · {omittedDays.length} 天 {openSections.has('omitted-days') ? '⌄' : '›'}</button>{openSections.has('omitted-days') ? <div className={group}>{omittedDays.map(renderDay)}</div> : null}</> : null}
    </> : null}
    {draft.strategy === 'daily_rolling' && pane === 'long' ? <div className={group}>
            <SelectionSection
              title="钉选桶"
              hint="保存时冻结"
              items={pinnedItems}
              selected={selectedPinned}
              open={openSections.has('pinned')}
              onToggleOpen={() => toggleSection('pinned')}
              onToggle={id => setSelectedPinned(current => toggleInSet(current, id))}
              onAll={() => setSelectedPinned(new Set(pinnedItems.map(item => item.id)))}
              onNone={() => setSelectedPinned(new Set())}
            />
            <SelectionSection
              title="日记"
              hint={`展示最近 ${Math.min(journalLimit, journalItems.length)} 篇未锁定日记候选`}
              items={journalVisible}
              selected={selectedJournals}
              open={openSections.has('journal')}
              onToggleOpen={() => toggleSection('journal')}
              onToggle={id => setSelectedJournals(current => toggleInSet(current, id))}
              onAll={() => setSelectedJournals(new Set(journalVisible.map(item => item.id)))}
              onNone={() => setSelectedJournals(new Set())}
              control={<LimitControl value={journalLimit} unit="篇" onChange={setJournalLimit} />}
            />
            <SelectionSection
              title="最近的桶"
              hint={`展示最近 ${Math.min(recentLimit, recentItems.length)} 个候选；排除特殊状态与 feel`}
              items={recentVisible}
              selected={selectedRecent}
              open={openSections.has('recent')}
              onToggleOpen={() => toggleSection('recent')}
              onToggle={id => setSelectedRecent(current => toggleInSet(current, id))}
              onAll={() => setSelectedRecent(new Set(recentVisible.map(item => item.id)))}
              onNone={() => setSelectedRecent(new Set())}
              control={<LimitControl value={recentLimit} unit="个" onChange={setRecentLimit} />}
            />
            <SelectionSection
              title="feel"
              hint={`展示最近 ${Math.min(feelLimit, feelItems.length)} 条候选；排除特殊状态`}
              items={feelVisible}
              selected={selectedFeels}
              open={openSections.has('feel')}
              onToggleOpen={() => toggleSection('feel')}
              onToggle={id => setSelectedFeels(current => toggleInSet(current, id))}
              onAll={() => setSelectedFeels(new Set(feelVisible.map(item => item.id)))}
              onNone={() => setSelectedFeels(new Set())}
              control={<LimitControl value={feelLimit} unit="条" onChange={setFeelLimit} />}
            />
            <SelectionSection
              title="随机高重要度桶"
              hint={`展示 ${Math.min(randomHighImportanceLimit, randomHighImportancePool.length)} 个候选；重要度 ≥ 7，避开最近候选`}
              items={randomHighImportanceVisible}
              selected={selectedRandomHighImportance}
              open={openSections.has('random-high')}
              onToggleOpen={() => toggleSection('random-high')}
              onToggle={id => setSelectedRandomHighImportance(current => toggleInSet(current, id))}
              onAll={() => setSelectedRandomHighImportance(new Set(randomHighImportanceVisible.map(item => item.id)))}
              onNone={() => setSelectedRandomHighImportance(new Set())}
              control={(
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xs">重要度 ≥ 7 随机</span>
                  <LimitControl value={randomHighImportanceLimit} unit="个" onChange={setRandomHighImportanceLimit} random />
                  <button type="button" onClick={() => setRandomBatch(current => current + 1)} className="min-h-11 text-2xs text-[var(--color-primary)]">换一批</button>
                </div>
              )}
            />
    </div> : null}
    {draft.strategy === 'fixed_window' || pane === 'settings' ? <div className="space-y-3">
      <div className={group}>
        <label className="flex min-h-11 items-center justify-between gap-2 pl-3 pr-2 text-xs text-[var(--color-text-secondary)]">上下文方式<select className="rolling-select min-h-11" value={draft.strategy} onChange={event => updateStrategy(event.target.value as RollingContextConfig['strategy'])}><option value="daily_rolling">按天滚动</option><option value="fixed_window">原换窗机制</option></select></label>
        <label className="flex min-h-11 items-center justify-between gap-2 border-t border-[var(--color-border-light)] pl-3 pr-2 text-xs text-[var(--color-text-secondary)]">一天从几点开始<select aria-label="一天开始时间（北京时间）" className="rolling-select min-h-11" value={draft.day_start_hour} onChange={event => setDraft({ ...draft, day_start_hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
      </div>
      {draft.strategy === 'fixed_window' ? <div className="text-2xs leading-relaxed text-[var(--color-text-tertiary)]">{session.rolling_context.strategy === 'daily_rolling' ? '切回后只会使用这个窗口创建时冻结的旧换窗资料，滚动期间的新对话不会自动带入。要保留最新衔接，请先使用“换窗继续”。' : '继续使用当前的冻结换窗资料和原生会话续接，不改变现有行为。'}</div> : <>
        <details className={group}><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs text-[var(--color-text-secondary)]">拼接规则</summary><ul className="list-disc space-y-1 px-7 pb-3 text-2xs leading-relaxed text-[var(--color-text-tertiary)]">
          <li>这里只决定下一轮能看到什么，不删除聊天记录。</li><li>新 revision 的最新一天原样保留。</li><li>更早的原文日保留正文、thinking 和工具；清理召回、图片和过期提醒，图片替换成 [图片]。</li><li>改回原文从存档恢复；存档整天缺失才用 Haven 正文补。相同 revision 冷恢复沿用原拼接。</li><li>旧召回离开上下文后可重新召回；原文期新写入或被 breath 看过的桶仍隔离。</li><li>钉选桶保存时冻结；总数不含系统提示词和每轮动态召回。</li>
        </ul></details>
        <details className={group}><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs text-[var(--color-primary)]">用 Haven 正文重建</summary><div className="px-3 pb-3 text-2xs leading-relaxed text-[var(--color-text-tertiary)]">旧 transcript 续不上时才使用。保留 Haven 聊天正文和本窗口，舍弃旧工具、召回、图片及失败半截轮次。
          <button type="button" disabled={recovering || saving || busy} onClick={() => void recoverFromHavenBody()} className="mt-2 min-h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-surface)] px-3 text-meta text-[var(--color-primary)] disabled:opacity-50">{recovering ? '正在重建…' : '舍弃损坏的原生记录，用 Haven 正文重建'}</button>
        </div></details>
      </>}
    </div> : null}
    {note ? <div className="text-2xs leading-relaxed text-[var(--color-text-tertiary)]">{note}</div> : null}
  </div>
}
