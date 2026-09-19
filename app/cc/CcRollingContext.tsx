'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ConversationContextDay,
  HavenConversationSession,
  RollingContextConfig,
} from '@/app/lib/havenTurns'
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

const SELECT = 'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)]'

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

function LimitControl({ value, unit, onChange }: { value: number; unit: string; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-[var(--color-text-disabled)]">
      展示候选
      <input type="number" min={0} value={value} onChange={event => onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)))} className="h-6 w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-center text-[11px] text-[var(--color-text-secondary)]" />
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
  const selectedChars = items.filter(item => selected.has(item.id)).reduce((sum, item) => sum + item.content.length, 0)
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button type="button" onClick={onToggleOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium text-[var(--color-text-heading)]">{title}</span>
          <span className="mt-0.5 block text-[9.5px] text-[var(--color-text-disabled)]">
            {hint} · 已选 {selectedCount}/{items.length} · {selectedChars.toLocaleString()} 字 · 约 {estimateHandoffTokens(items.filter(item => selected.has(item.id)).map(item => item.content).join('\n\n')).toLocaleString()} token
          </span>
        </span>
        <span className="text-[10px] text-[var(--color-text-disabled)]">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div className="border-t border-[var(--color-border-light)] px-3 pb-2.5 pt-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <div>{control}</div>
            {items.length > 0 ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={onAll} className="text-[var(--color-primary)]">全选当前候选</button>
                <span className="text-[var(--color-border)]">|</span>
                <button type="button" onClick={onNone} className="text-[var(--color-primary)]">全不选</button>
              </div>
            ) : null}
          </div>
          {items.length === 0 ? (
            <div className="py-2 text-center text-[10px] text-[var(--color-text-disabled)]">暂无可选内容</div>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {items.map(item => (
                <label key={item.id} className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 transition-colors ${selected.has(item.id) ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary-muted)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30'}`}>
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-[var(--color-text-secondary)]">{item.title}</span>
                    <span className="mt-0.5 block text-[9px] text-[var(--color-text-disabled)]">
                      {item.note ? `${item.note} · ` : ''}{item.content.length.toLocaleString()} 字
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
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`/api/cc-turns?session_id=${encodeURIComponent(sessionId)}&limit=1&context_days=1`, { cache: 'no-store' }),
      fetch('/api/buckets?full=1', { cache: 'no-store' }),
      fetch('/api/journal', { cache: 'no-store' }),
    ])
      .then(async ([turnsRes, bucketsRes, journalRes]) => {
        const [turnsData, bucketsData, journalData] = await Promise.all([
          turnsRes.json(),
          bucketsRes.json(),
          journalRes.json(),
        ])
        if (!turnsRes.ok || !turnsData.ok || !turnsData.session) throw new Error(turnsData.error || '读取失败')
        if (cancelled) return

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
            feel: type === 'feel' || hasMarker('feel'),
            journal: type === 'journal',
          }]
        })
        const pinned: Candidate[] = buckets.filter(bucket => bucket.pinned)
        setPinnedItems(pinned)

        const eligible = buckets.filter(bucket => !bucket.pinned && !bucket.archived && !bucket.noise
          && !bucket.resolved && !bucket.digested && !bucket.journal)
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
        setSelectedFeels(new Set(rollingContext.selected_feel_ids || []))
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
      })
      .catch(error => { if (!cancelled) setNote(error instanceof Error ? error.message : '读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const estimatedChars = useMemo(() => days.reduce((total, day) => {
    const mode = draft?.day_modes?.[day.day] || (draft?.strategy === 'daily_rolling' ? 'raw' : 'omit')
    if (mode === 'raw') return total + day.raw_chars
    if (mode === 'review') return total + (day.review?.chars || 0)
    return total
  }, 0), [days, draft])

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

  const estimatedTotalTokens = useMemo(() => {
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
    return Math.ceil(estimatedChars * 1.3) + longTermTokens
  }, [estimatedChars, feelItems, highImportanceItems, journalItems, pinnedItems, recentItems, selectedFeels, selectedJournals, selectedPinned, selectedRandomHighImportance, selectedRecent])

  if (loading) return <div className="py-8 text-center text-[11px] text-[var(--color-text-disabled)]">读取上下文日期…</div>
  if (!draft || !session) return <div className="text-[11px] text-red-600">{note || '没有可用的窗口配置'}</div>

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
    const switchingToRolling = session.rolling_context?.strategy === 'fixed_window'
      && draft.strategy === 'daily_rolling'
    const switchingToFixed = session.rolling_context?.strategy === 'daily_rolling'
      && draft.strategy === 'fixed_window'
    if (switchingToRolling && !window.confirm(
      '首次开启会优先把固定窗口的原生 transcript 完整迁入，保留工具、召回和 thinking。\n\n如果旧 transcript 已不存在，是否允许改为只恢复 Haven 中可见的用户与助手正文？取消则不保存。',
    )) return
    if (switchingToFixed && !window.confirm(
      '切回原换窗机制后，这个窗口只会使用创建时冻结的旧换窗资料，滚动期间的新对话不会自动带入。\n\n如果要保留最新衔接，请取消并先使用“换窗继续”。仍要直接切回吗？',
    )) return
    const restoredDays = days.filter(day => {
      const savedMode = session.rolling_context?.day_modes?.[day.day] || 'raw'
      const nextMode = draft.day_modes?.[day.day] || 'raw'
      return savedMode !== 'raw' && nextMode === 'raw'
    })
    if (restoredDays.length > 0 && !window.confirm(
      `将 ${restoredDays.length} 个旧日期重新设为“原文”时，只会恢复 Haven 中可见的用户与助手正文，不会恢复当时的工具调用、工具结果和动态召回过程。仍要保存吗？`,
    )) return
    setSaving(true)
    setNote('')
    try {
      const rollingContext = {
        ...draft,
        allow_fixed_body_restore: switchingToRolling
          ? true
          : draft.allow_fixed_body_restore,
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

  return (
    <div>
      <div className="mb-2 text-[11px] text-[var(--color-text-disabled)]">上下文方式</div>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => updateStrategy('fixed_window')} className={`${SELECT} ${draft.strategy === 'fixed_window' ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]' : ''}`}>原换窗机制</button>
        <button type="button" onClick={() => updateStrategy('daily_rolling')} className={`${SELECT} ${draft.strategy === 'daily_rolling' ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]' : ''}`}>按天滚动</button>
      </div>

      {draft.strategy === 'daily_rolling' ? (
        <>
          <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] p-2.5 text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">
            这里只决定模型下一轮能看到什么，不删除聊天记录。原文日里的已召回记忆不会重复召回；改成日回顾或不带后，以后可以再次召回。
          </div>
          <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-pending-border)] bg-[var(--color-pending-bg)] p-2.5 text-[10.5px] leading-relaxed text-[var(--color-pending)]">
            已经退出“原文”的旧日期以后重新设为“原文”时，只会从 Haven 恢复可见的用户与助手正文；当时的工具调用、工具结果和动态召回过程不会恢复。
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="text-[11px] text-[var(--color-text-tertiary)]">一天从北京时间</label>
            <select className={SELECT} value={draft.day_start_hour} onChange={event => setDraft({ ...draft, day_start_hour: Number(event.target.value) })}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </div>
          <div className="mb-2 flex justify-between text-[10.5px] text-[var(--color-text-disabled)]">
            <span>日期内容</span><span>约 {estimatedChars.toLocaleString()} 字</span>
          </div>
          <div className="space-y-1.5">
            {[...days].sort((a, b) => b.day.localeCompare(a.day)).map(day => {
              const mode = draft.day_modes?.[day.day] || 'raw'
              const savedMode = session.rolling_context?.day_modes?.[day.day] || 'raw'
              const bodyRestore = savedMode !== 'raw' && mode === 'raw'
              return (
                <div key={day.day} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-secondary)]">
                      <span>{day.day}</span>
                      {bodyRestore ? <span className="rounded-full bg-[var(--color-pending-bg)] px-1.5 py-0.5 text-[9px] text-[var(--color-pending)]">正文恢复</span> : null}
                    </div>
                    <div className="text-[9.5px] text-[var(--color-text-disabled)]">{day.turn_count} 轮 · 原文 {day.raw_chars.toLocaleString()} 字{day.review ? ` · 回顾 ${day.review.chars.toLocaleString()} 字` : ' · 暂无日回顾'}</div>
                  </div>
                  <select
                    className={SELECT}
                    value={mode}
                    onChange={event => setDraft({ ...draft, day_modes: { ...draft.day_modes, [day.day]: event.target.value as 'raw' | 'review' | 'omit' } })}
                  >
                    <option value="raw">原文</option>
                    <option value="review" disabled={!day.review}>日回顾</option>
                    <option value="omit">不带</option>
                  </select>
                </div>
              )
            })}
          </div>

          <div className={`mb-3 mt-4 rounded-[var(--radius-md)] border px-2.5 py-2 text-[10.5px] leading-relaxed ${estimatedTotalTokens >= 100000 ? 'border-[var(--color-pending-border)] bg-[var(--color-pending-bg)] text-[var(--color-pending)]' : 'border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]'}`}>
            当前日期内容与长期层已选项预估约 {estimatedTotalTokens.toLocaleString()} token（不含系统提示词和后续动态召回）。
            {estimatedTotalTokens >= 100000 ? ' 已超过 10 万，建议精简；保存时不会自动截断。' : ''}
          </div>
          <div className="mb-2 text-[10.5px] text-[var(--color-text-disabled)]">长期层</div>
          <div className="space-y-1.5">
            <SelectionSection
              title="钉选桶"
              hint="每轮实时读取最新正文"
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
              control={<LimitControl value={recentLimit} unit="个桶" onChange={setRecentLimit} />}
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
                <div className="flex items-center gap-2">
                  <LimitControl value={randomHighImportanceLimit} unit="个桶" onChange={setRandomHighImportanceLimit} />
                  <button type="button" onClick={() => setRandomBatch(current => current + 1)} className="text-[10px] text-[var(--color-primary)] hover:underline">换一批</button>
                </div>
              )}
            />
          </div>
        </>
      ) : (
        <div className={`rounded-[var(--radius-md)] px-2.5 py-2 text-[10.5px] leading-relaxed ${
          session.rolling_context?.strategy === 'daily_rolling'
            ? 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]'
            : 'text-[var(--color-text-disabled)]'
        }`}>
          {session.rolling_context?.strategy === 'daily_rolling'
            ? '切回后只会使用这个窗口创建时冻结的旧换窗资料，滚动期间的新对话不会自动带入。要保留最新衔接，请先使用“换窗继续”。'
            : '继续使用当前的冻结换窗资料和原生会话续接，不改变现有行为。'}
        </div>
      )}

      <button type="button" disabled={saving || busy} onClick={() => void save()} className="mt-4 w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-2 text-[11.5px] text-white disabled:opacity-50">
        {saving ? '保存中…' : busy ? '回复结束后可保存' : '保存上下文拼接'}
      </button>
      {draft.strategy === 'daily_rolling' ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-red-50/60 p-2.5">
          <div className="text-[10.5px] font-medium text-[var(--color-danger)]">损坏窗口恢复</div>
          <div className="mt-1 text-[9.5px] leading-relaxed text-[var(--color-text-tertiary)]">
            仅在旧 transcript 无法继续时使用。保留 Haven 聊天正文和本窗口，舍弃旧工具、召回、图片及失败半截轮次。
          </div>
          <button
            type="button"
            disabled={recovering || saving || busy}
            onClick={() => void recoverFromHavenBody()}
            className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-white px-3 py-2 text-[10.5px] text-[var(--color-danger)] disabled:opacity-50"
          >
            {recovering ? '正在重建…' : '舍弃损坏的原生记录，用 Haven 正文重建'}
          </button>
        </div>
      ) : null}
      {note ? <div className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">{note}</div> : null}
    </div>
  )
}
