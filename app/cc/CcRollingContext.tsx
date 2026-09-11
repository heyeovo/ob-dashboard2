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
          {items.length > 0 ? (
            <div className="mb-2 flex items-center justify-end gap-2 text-[10px]">
              <button type="button" onClick={onAll} className="text-[var(--color-primary)]">全选</button>
              <span className="text-[var(--color-border)]">|</span>
              <button type="button" onClick={onNone} className="text-[var(--color-primary)]">全不选</button>
            </div>
          ) : null}
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
  const [note, setNote] = useState('')
  const [pinnedItems, setPinnedItems] = useState<Candidate[]>([])
  const [journalItems, setJournalItems] = useState<Candidate[]>([])
  const [selectedPinned, setSelectedPinned] = useState<Set<string>>(new Set())
  const [selectedJournals, setSelectedJournals] = useState<Set<string>>(new Set())
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
        const pinned: Candidate[] = rawBuckets
          .filter((b: Record<string, unknown>) => {
            const meta = b?.metadata as Record<string, unknown> | undefined
            return b?.pinned ?? meta?.pinned
          })
          .filter((b: Record<string, unknown>) => String(b?.id || '').trim() && String(b?.content || '').trim())
          .map((b: Record<string, unknown>): Candidate => ({
            id: String(b.id),
            title: String(b.name || (b.metadata as Record<string, unknown>)?.name || b.id),
            content: String(b.content || ''),
          }))
        setPinnedItems(pinned)

        const savedPinnedIds = rollingContext.selected_pinned_ids
        setSelectedPinned(
          savedPinnedIds != null
            ? new Set(savedPinnedIds)
            : new Set(pinned.map(item => item.id)),
        )

        const rawJournals = Array.isArray(journalData) ? journalData : (journalData?.items || [])
        const journals: Candidate[] = rawJournals
          .filter((j: Record<string, unknown>) => !j?.locked && String(j?.content || '').trim())
          .map((j: Record<string, unknown>): Candidate => ({
            id: String(j.id),
            title: String(j.name || j.title || j.id),
            content: String(j.content || ''),
            note: String(j.author || ''),
          }))
          .sort((a: Candidate, b: Candidate) => b.title.localeCompare(a.title))
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
    const switchingToFixed = session.rolling_context?.strategy === 'daily_rolling'
      && draft.strategy === 'fixed_window'
    if (switchingToFixed && !window.confirm(
      '切回原换窗机制后，这个窗口只会使用创建时冻结的旧换窗资料，滚动期间的新对话不会自动带入。\n\n如果要保留最新衔接，请取消并先使用“换窗继续”。仍要直接切回吗？',
    )) return
    setSaving(true)
    setNote('')
    try {
      const rollingContext = {
        ...draft,
        selected_pinned_ids: [...selectedPinned],
        selected_journal_ids: [...selectedJournals],
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
              return (
                <div key={day.day} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] text-[var(--color-text-secondary)]">{day.day}</div>
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

          <div className="mb-2 mt-4 text-[10.5px] text-[var(--color-text-disabled)]">长期层</div>
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
              hint="未锁定的日记"
              items={journalItems}
              selected={selectedJournals}
              open={openSections.has('journal')}
              onToggleOpen={() => toggleSection('journal')}
              onToggle={id => setSelectedJournals(current => toggleInSet(current, id))}
              onAll={() => setSelectedJournals(new Set(journalItems.map(item => item.id)))}
              onNone={() => setSelectedJournals(new Set())}
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
      {note ? <div className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">{note}</div> : null}
    </div>
  )
}
