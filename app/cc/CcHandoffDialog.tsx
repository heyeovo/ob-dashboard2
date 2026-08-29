'use client'

import { useEffect, useMemo, useState } from 'react'
import { MODE_HINT, MODE_LABEL, type CcMode } from '@/app/lib/ccModes'
import {
  buildHandoffSnapshot,
  estimateHandoffTokens,
  type HandoffItemKind,
  type HandoffSnapshot,
  type HandoffSourceItem,
} from '@/app/lib/cc/handoffSnapshot'

export type HandoffTurnPreview = {
  id: number
  round_id: number
  created_at: string
  user_text: string
  assistant_text: string
}

export type HandoffPayload = {
  mode: CcMode
  snapshot: HandoffSnapshot
  chatTurns: HandoffTurnPreview[]
  fromSessionId: string | null
}

type Candidate = {
  id: string
  title: string
  content: string
  created: string
  note?: string
}

function formatMessageTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

type Props = {
  fromSessionId: string | null
  currentMode: CcMode
  personaId: string
  onConfirm: (payload: HandoffPayload) => void
  onClose: () => void
}

type SectionProps = {
  id: string
  title: string
  hint: string
  items: Candidate[]
  selected: Set<string>
  open: boolean
  loading: boolean
  onOpen: () => void
  onToggle: (id: string) => void
  onAll: () => void
  onNone: () => void
  control?: React.ReactNode
}

function countStats(items: Candidate[], selected: Set<string>) {
  const text = items.filter(item => selected.has(item.id)).map(item => item.content).join('\n\n')
  return { chars: text.length, tokens: estimateHandoffTokens(text) }
}

function SelectionSection({ id, title, hint, items, selected, open, loading, onOpen, onToggle, onAll, onNone, control }: SectionProps) {
  const selectedCount = items.filter(item => selected.has(item.id)).length
  const stats = countStats(items, selected)
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button type="button" aria-expanded={open} aria-controls={`handoff-${id}`} onClick={onOpen} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-[var(--color-text-heading)]">{title}</span>
          <span className="mt-0.5 block text-[10px] text-[var(--color-text-disabled)]">
            {hint} · 已选 {selectedCount}/{items.length} · {stats.chars.toLocaleString()} 字 · 约 {stats.tokens.toLocaleString()} token
          </span>
        </span>
        <span className="text-[11px] text-[var(--color-text-disabled)]">{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div id={`handoff-${id}`} className="border-t border-[var(--color-border-light)] px-3.5 pb-3 pt-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>{control}</div>
            {items.length > 0 ? (
              <div className="flex items-center gap-2 text-[10.5px]">
                <button type="button" onClick={onAll} className="text-[var(--color-primary)] hover:underline">全选</button>
                <span className="text-[var(--color-border)]">|</span>
                <button type="button" onClick={onNone} className="text-[var(--color-primary)] hover:underline">全不选</button>
              </div>
            ) : null}
          </div>
          {loading ? (
            <div className="py-3 text-center text-[11px] text-[var(--color-text-disabled)]">加载中</div>
          ) : items.length === 0 ? (
            <div className="py-3 text-center text-[11px] text-[var(--color-text-disabled)]">暂无可选内容</div>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
              {items.map(item => (
                <label key={item.id} className={`flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 transition-colors ${selected.has(item.id) ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary-muted)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30'}`}>
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-[var(--color-text-secondary)]">{item.title}</span>
                    <span className="mt-0.5 block text-[9.5px] text-[var(--color-text-disabled)]">
                      {item.note ? `${item.note} · ` : ''}{item.content.length.toLocaleString()} 字 · 约 {estimateHandoffTokens(item.content).toLocaleString()} token
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

function LimitControl({ value, unit, max, onChange }: { value: number; unit: string; max?: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-[var(--color-text-disabled)]">
      展示最近
      <input type="number" min={0} max={max} value={value} onChange={event => onChange(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(event.target.value) || 0))))} className="h-6 w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-center text-[11px] text-[var(--color-text-secondary)]" />
      {unit}
    </label>
  )
}

function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
  setter(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

export default function CcHandoffDialog({ fromSessionId, currentMode, personaId, onConfirm, onClose }: Props) {
  const [mode, setMode] = useState<CcMode>(currentMode)
  const [pinned, setPinned] = useState<Candidate[]>([])
  const [recent, setRecent] = useState<Candidate[]>([])
  const [feels, setFeels] = useState<Candidate[]>([])
  const [journals, setJournals] = useState<Candidate[]>([])
  const [dailyReviews, setDailyReviews] = useState<Candidate[]>([])
  const [turns, setTurns] = useState<HandoffTurnPreview[]>([])
  const [selectedPinned, setSelectedPinned] = useState<Set<string>>(new Set())
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(new Set())
  const [selectedFeels, setSelectedFeels] = useState<Set<string>>(new Set())
  const [selectedJournals, setSelectedJournals] = useState<Set<string>>(new Set())
  const [selectedDailyReviews, setSelectedDailyReviews] = useState<Set<string>>(new Set())
  const [selectedTurns, setSelectedTurns] = useState<Set<string>>(new Set())
  const [recentLimit, setRecentLimit] = useState(10)
  const [feelLimit, setFeelLimit] = useState(10)
  const [journalLimit, setJournalLimit] = useState(10)
  const [dailyReviewLimit, setDailyReviewLimit] = useState(5)
  const [turnLimit, setTurnLimit] = useState(20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openSections, setOpenSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const requests: Promise<Response>[] = [
          fetch('/api/buckets?full=1', { cache: 'no-store', signal: controller.signal }),
          fetch('/api/journal', { cache: 'no-store', signal: controller.signal }),
          fetch(`/api/daily-reviews?persona_id=${encodeURIComponent(personaId)}&limit=366`, { cache: 'no-store', signal: controller.signal }),
        ]
        if (fromSessionId) requests.push(fetch(`/api/cc-turns?session_id=${encodeURIComponent(fromSessionId)}&all=1`, { cache: 'no-store', signal: controller.signal }))
        const responses = await Promise.all(requests)
        const payloads = await Promise.all(responses.map(response => response.json().catch(() => ({}))))
        const failed = responses.findIndex(response => !response.ok)
        if (failed >= 0) throw new Error(String(payloads[failed]?.error || `读取换窗资料失败（${responses[failed].status}）`))

        const rawBuckets = Array.isArray(payloads[0]) ? payloads[0] : (payloads[0]?.buckets || [])
        const bucketItems = rawBuckets.map((raw: any): Candidate & { pinned: boolean; type: string; tags: string[] } => {
          const metadata = raw?.metadata || {}
          return {
            id: String(raw?.id || ''),
            title: String(raw?.name || raw?.title || metadata?.name || raw?.id || ''),
            content: String(raw?.content || ''),
            created: String(raw?.event_time || raw?.created || metadata?.event_time || metadata?.created || ''),
            pinned: Boolean(raw?.pinned ?? metadata?.pinned),
            type: String(raw?.type || metadata?.type || 'dynamic'),
            tags: Array.isArray(raw?.tags || metadata?.tags) ? (raw?.tags || metadata?.tags).map(String) : [],
          }
        }).filter((item: Candidate) => item.id && item.content.trim())
        const pinnedItems = bucketItems.filter((item: any) => item.pinned)
        const feelItems = bucketItems.filter((item: any) => !item.pinned && item.type === 'feel' && !item.tags.some((tag: string) => ['whisper', 'daily_impression', 'weekly_impression', 'relationship_weather'].includes(tag))).sort((a: Candidate, b: Candidate) => b.created.localeCompare(a.created))
        const recentItems = bucketItems.filter((item: any) => !item.pinned && !['feel', 'archived', 'journal'].includes(item.type)).sort((a: Candidate, b: Candidate) => b.created.localeCompare(a.created))
        setPinned(pinnedItems)
        setRecent(recentItems)
        setFeels(feelItems)
        setSelectedPinned(new Set(pinnedItems.map((item: Candidate) => item.id)))

        const journalItems = (Array.isArray(payloads[1]) ? payloads[1] : (payloads[1]?.items || []))
          .filter((item: any) => !item?.locked && String(item?.content || '').trim())
          .map((item: any): Candidate => ({ id: String(item.id), title: String(item.name || item.id), content: String(item.content || ''), created: String(item.event_time || item.created || ''), note: String(item.author || '') }))
          .sort((a: Candidate, b: Candidate) => b.created.localeCompare(a.created))
        setJournals(journalItems)

        const reviewItems = (Array.isArray(payloads[2]?.items) ? payloads[2].items : [])
          .filter((item: any) => String(item?.content || '').trim())
          .map((item: any): Candidate => ({ id: String(item.review_date), title: String(item.review_date), content: String(item.content || ''), created: String(item.review_date || '') }))
          .sort((a: Candidate, b: Candidate) => b.created.localeCompare(a.created))
        setDailyReviews(reviewItems)

        if (fromSessionId) setTurns(Array.isArray(payloads[3]?.turns) ? payloads[3].turns : [])
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取换窗资料失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [fromSessionId, personaId])

  const recentVisible = recent.slice(0, recentLimit)
  const feelVisible = feels.slice(0, feelLimit)
  const journalVisible = journals.slice(0, journalLimit)
  const dailyReviewVisible = dailyReviews.slice(0, dailyReviewLimit)
  const turnVisible = turnLimit > 0 ? turns.slice(-turnLimit) : []
  const turnCandidates = turnVisible.map(turn => ({
    id: String(turn.id),
    title: `第 ${turn.round_id} 轮`,
    content: [
      turn.user_text?.trim() ? `[${formatMessageTime(turn.created_at)}] 小羊：${turn.user_text.trim()}` : '',
      turn.assistant_text?.trim() ? `[${formatMessageTime(turn.created_at)}] 言之：${turn.assistant_text.trim()}` : '',
    ].filter(Boolean).join('\n\n'),
    created: turn.created_at,
  }))

  const sourceItems = useMemo(() => {
    const groups: Array<{ kind: HandoffItemKind; items: Candidate[]; selected: Set<string> }> = [
      { kind: 'daily_review', items: dailyReviewVisible, selected: selectedDailyReviews },
      { kind: 'pinned', items: pinned, selected: selectedPinned },
      { kind: 'recent', items: recentVisible, selected: selectedRecent },
      { kind: 'feel', items: feelVisible, selected: selectedFeels },
      { kind: 'journal', items: journalVisible, selected: selectedJournals },
      { kind: 'chat', items: turnCandidates, selected: selectedTurns },
    ]
    return groups.flatMap(group => group.items.filter(item => group.selected.has(item.id)).map((item): HandoffSourceItem => ({ kind: group.kind, id: item.id, title: item.title, content: item.content })))
  }, [dailyReviewVisible, feelVisible, journalVisible, pinned, recentVisible, selectedDailyReviews, selectedFeels, selectedJournals, selectedPinned, selectedRecent, selectedTurns, turnCandidates])
  const snapshot = useMemo(() => buildHandoffSnapshot(sourceItems), [sourceItems])
  const effectiveChatIds = new Set(snapshot.items.filter(item => item.kind === 'chat').map(item => item.id))
  const effectiveTurns = turnVisible.filter(turn => effectiveChatIds.has(String(turn.id)))

  const toggleOpen = (id: string) => setOpenSections(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const replaceVisible = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, items: Candidate[], checked: boolean) => setter(previous => {
    const next = new Set(previous)
    for (const item of items) checked ? next.add(item.id) : next.delete(item.id)
    return next
  })

  const sections: Array<SectionProps> = [
    { id: 'daily', title: '日回顾', hint: `最近 ${dailyReviewVisible.length} 天`, items: dailyReviewVisible, selected: selectedDailyReviews, open: openSections.has('daily'), loading, onOpen: () => toggleOpen('daily'), onToggle: id => toggleSet(setSelectedDailyReviews, id), onAll: () => replaceVisible(setSelectedDailyReviews, dailyReviewVisible, true), onNone: () => replaceVisible(setSelectedDailyReviews, dailyReviewVisible, false), control: <LimitControl value={dailyReviewLimit} unit="天" max={366} onChange={setDailyReviewLimit} /> },
    { id: 'pinned', title: '钉选桶', hint: '唯一默认全选', items: pinned, selected: selectedPinned, open: openSections.has('pinned'), loading, onOpen: () => toggleOpen('pinned'), onToggle: id => toggleSet(setSelectedPinned, id), onAll: () => replaceVisible(setSelectedPinned, pinned, true), onNone: () => replaceVisible(setSelectedPinned, pinned, false) },
    { id: 'recent', title: '最近记忆', hint: `最近 ${recentVisible.length} 个桶`, items: recentVisible, selected: selectedRecent, open: openSections.has('recent'), loading, onOpen: () => toggleOpen('recent'), onToggle: id => toggleSet(setSelectedRecent, id), onAll: () => replaceVisible(setSelectedRecent, recentVisible, true), onNone: () => replaceVisible(setSelectedRecent, recentVisible, false), control: <LimitControl value={recentLimit} unit="个桶" onChange={setRecentLimit} /> },
    { id: 'feel', title: 'feel', hint: `最近 ${feelVisible.length} 条`, items: feelVisible, selected: selectedFeels, open: openSections.has('feel'), loading, onOpen: () => toggleOpen('feel'), onToggle: id => toggleSet(setSelectedFeels, id), onAll: () => replaceVisible(setSelectedFeels, feelVisible, true), onNone: () => replaceVisible(setSelectedFeels, feelVisible, false), control: <LimitControl value={feelLimit} unit="条" onChange={setFeelLimit} /> },
    { id: 'journal', title: 'journal', hint: `最近 ${journalVisible.length} 篇未锁定日记`, items: journalVisible, selected: selectedJournals, open: openSections.has('journal'), loading, onOpen: () => toggleOpen('journal'), onToggle: id => toggleSet(setSelectedJournals, id), onAll: () => replaceVisible(setSelectedJournals, journalVisible, true), onNone: () => replaceVisible(setSelectedJournals, journalVisible, false), control: <LimitControl value={journalLimit} unit="篇" onChange={setJournalLimit} /> },
  ]
  if (fromSessionId) sections.push({ id: 'chat', title: '旧窗口聊天正文', hint: `最近 ${turnCandidates.length} 轮可逐项选择`, items: turnCandidates, selected: selectedTurns, open: openSections.has('chat'), loading, onOpen: () => toggleOpen('chat'), onToggle: id => toggleSet(setSelectedTurns, id), onAll: () => replaceVisible(setSelectedTurns, turnCandidates, true), onNone: () => replaceVisible(setSelectedTurns, turnCandidates, false), control: <LimitControl value={turnLimit} unit="轮" onChange={setTurnLimit} /> })

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      <div className="cc-modal relative flex max-h-[90vh] w-full max-w-lg flex-col" role="dialog" aria-label="新对话">
        <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-5 py-3.5">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-heading)]">{fromSessionId ? '换窗' : '新对话'}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">选择并冻结这个窗口要带入的背景</div>
          </div>
          <button type="button" onClick={onClose} className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">取消</button>
        </div>
        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-1.5 text-[11px] text-[var(--color-text-disabled)]">模式</div>
          <div className="mb-4 flex gap-2.5">
            {(['chat', 'work'] as const).map(itemMode => (
              <button key={itemMode} type="button" onClick={() => setMode(itemMode)} className={`flex-1 rounded-[var(--radius-lg)] border px-3.5 py-2.5 text-left transition-colors ${mode === itemMode ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/40'}`}>
                <span className="block text-[12px] font-medium text-[var(--color-text-heading)]">{MODE_LABEL[itemMode]}</span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">{MODE_HINT[itemMode]}</span>
              </button>
            ))}
          </div>
          {error ? <div className="mb-3 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div> : null}
          <div className="space-y-2">{sections.map(section => <SelectionSection key={section.id} {...section} />)}</div>
        </div>
        <div className="border-t border-[var(--color-border-light)] px-5 py-3.5">
          <div className={`mb-2.5 rounded-[var(--radius-md)] border px-3 py-2 ${snapshot.stats.over_budget ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'}`}>
            <div className="text-[11px] font-medium">本次选择：{snapshot.stats.selected_chars.toLocaleString()} 字 · 约 {snapshot.stats.selected_estimated_tokens.toLocaleString()} token</div>
            <div className="mt-0.5 text-[10px] opacity-80">
              统一预算 {snapshot.stats.budget_tokens.toLocaleString()} token{snapshot.stats.over_budget ? `；超出部分会按相同规则裁剪，实际约 ${snapshot.stats.effective_estimated_tokens.toLocaleString()} token，省略 ${snapshot.stats.dropped_item_count} 项` : '；CC 与 selfhost 将使用同一份固定快照'}
            </div>
          </div>
          <button type="button" onClick={() => onConfirm({ mode, snapshot, chatTurns: effectiveTurns, fromSessionId })} disabled={loading || Boolean(error)} className="w-full rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{fromSessionId ? '换窗开始' : '开始新对话'}</button>
        </div>
      </div>
    </div>
  )
}
