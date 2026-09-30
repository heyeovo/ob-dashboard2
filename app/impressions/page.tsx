'use client'

import SubpageBackButton from '@/app/components/SubpageBackButton'
import WeekCalendar from '@/app/components/WeekCalendar'
import { MONTHS_ZH } from '../journal/journalData'
import { useCallback, useEffect, useMemo, useState } from 'react'
import BucketDetailDrawer from '../components/BucketDetailDrawer'
import { bucketDate, bucketName, isLegacyDailyImpression } from '../lib/dailyBucketDate'
import { getMonthChapters } from '../memory/memoryFilters'
import type { Bucket } from '../memory/memoryTypes'

type Persona = { id: string; name?: string }
type DailyReview = {
  review_date: string
  content: string
  edited_by_user?: boolean
  source_turn_count?: number
  model?: string
}
type BucketListItem = {
  id: string
  name?: string
  type?: string
  tags?: string[]
  created?: string
  event_time?: string
  content_preview?: string
  metadata?: Record<string, unknown>
}
type BucketDetail = {
  id: string
  content: string
  score: number
  noise?: boolean
  wish?: boolean
  type?: string
  valence?: number
  arousal?: number
  metadata: {
    name: string
    domain: string[]
    tags: string[]
    valence: number
    arousal: number
    importance: number
    pinned: boolean
    resolved: boolean
    digested?: boolean
    type: string
    created: string
    last_active: string
    activation_count?: number
    related?: string[]
    event_time?: string
    source?: string
    wish?: boolean
  }
}
type CalendarCell = { key: string; day: number; inMonth: boolean }

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
})

function makeCalendar(year: number, month: number): CalendarCell[] {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const previousMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: CalendarCell[] = []
  for (let index = 0; index < 42; index += 1) {
    const offset = index - firstWeekday + 1
    if (offset < 1) {
      const day = previousMonthDays + offset
      const previous = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
      cells.push({ key: `${previous.year}-${String(previous.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day, inMonth: false })
    } else if (offset > daysInMonth) {
      const day = offset - daysInMonth
      const next = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
      cells.push({ key: `${next.year}-${String(next.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day, inMonth: false })
    } else {
      cells.push({ key: `${year}-${String(month + 1).padStart(2, '0')}-${String(offset).padStart(2, '0')}`, day: offset, inMonth: true })
    }
  }
  return cells
}

function previousDate(date: string) {
  const value = new Date(`${date}T12:00:00+08:00`)
  value.setUTCDate(value.getUTCDate() - 1)
  return DATE_FORMATTER.format(value)
}

function nextDate(date: string) {
  const value = new Date(`${date}T12:00:00+08:00`)
  value.setUTCDate(value.getUTCDate() + 1)
  return DATE_FORMATTER.format(value)
}

export default function DailyReviewsPage() {
  const today = DATE_FORMATTER.format(new Date())
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reviewMenuOpen, setReviewMenuOpen] = useState(false)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [personaId, setPersonaId] = useState('ombre')
  const [reviews, setReviews] = useState<DailyReview[]>([])
  const [buckets, setBuckets] = useState<BucketListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingDate, setGeneratingDate] = useState('')
  const [selectedBucket, setSelectedBucket] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [bucketEditing, setBucketEditing] = useState(false)
  const [bucketEditContent, setBucketEditContent] = useState('')
  const [bucketSaving, setBucketSaving] = useState(false)
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get('date')
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) {
      setSelectedDate(date)
      setYear(Number(date.slice(0, 4)))
      setMonth(Number(date.slice(5, 7)) - 1)
    }
  }, [])

  const loadData = useCallback(async (selectedPersona: string, signal?: AbortSignal) => {
    setError('')
    const [reviewResponse, bucketResponse] = await Promise.all([
      fetch(`/api/daily-reviews?persona_id=${encodeURIComponent(selectedPersona)}&limit=366`, { cache: 'no-store', signal }),
      fetch(`/api/buckets?full=1&_t=${Date.now()}`, { cache: 'no-store', signal }),
    ])
    const reviewData = await reviewResponse.json().catch(() => ({}))
    if (!reviewResponse.ok || reviewData.ok === false) throw new Error(String(reviewData.error || `读取日回顾失败（${reviewResponse.status}）`))
    if (!bucketResponse.ok) throw new Error(`读取记忆事件失败（${bucketResponse.status}）`)
    const bucketData = await bucketResponse.json()
    setReviews(Array.isArray(reviewData.items) ? reviewData.items : [])
    setBuckets(Array.isArray(bucketData) ? bucketData : (bucketData.buckets || []))
  }, [])

  useEffect(() => {
    fetch('/api/cc-personas', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => {
        const items = Array.isArray(data.personas) ? data.personas : Array.isArray(data.items) ? data.items : []
        setPersonas(items)
        if (items.length > 0 && !items.some((item: Persona) => item.id === 'ombre')) setPersonaId(items[0].id)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setEditing(false)
    loadData(personaId, controller.signal)
      .catch(reason => { if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败') })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadData, personaId])

  const cells = useMemo(() => makeCalendar(year, month), [year, month])
  const reviewMap = useMemo(() => new Map(reviews.map(review => [review.review_date, review])), [reviews])
  const reviewDates = useMemo(() => new Set(reviews.map(review => review.review_date)), [reviews])
  const eventBuckets = useMemo(() => buckets.filter(bucket => !isLegacyDailyImpression(bucket)), [buckets])
  const eventDates = useMemo(() => new Set(eventBuckets.map(bucketDate).filter((value): value is string => Boolean(value))), [eventBuckets])
  const selectedReview = reviewMap.get(selectedDate)
  const selectedEvents = useMemo(() => eventBuckets.filter(bucket => bucketDate(bucket) === selectedDate), [eventBuckets, selectedDate])
  const chapters = useMemo(() => getMonthChapters(buckets as unknown as Bucket[]), [buckets])
  const selectedCellIndex = Math.max(0, cells.findIndex(cell => cell.key === selectedDate))
  const weekCells = cells.slice(Math.floor(selectedCellIndex / 7) * 7, Math.floor(selectedCellIndex / 7) * 7 + 7)
  const selectedDay = new Date(`${selectedDate}T12:00:00+08:00`)
  const selectedLabel = `${Number(selectedDate.slice(5, 7))}月${Number(selectedDate.slice(8))}日 · 周${WEEKDAYS[(selectedDay.getUTCDay() + 6) % 7]}`

  const selectDate = (date: string) => {
    setSelectedDate(date)
    setYear(Number(date.slice(0, 4)))
    setMonth(Number(date.slice(5, 7)) - 1)
    setEditing(false)
    setNotice('')
  }

  const changeMonth = (offset: number) => {
    const next = new Date(Date.UTC(year, month + offset, 1))
    const date = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
    selectDate(date)
  }

  const generateReview = async (reviewDate: string, force = false, overrideUserEdit = false) => {
    setGeneratingDate(reviewDate)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/daily-reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: personaId, review_date: reviewDate, force, override_user_edit: overrideUserEdit }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data.error || `生成失败（${response.status}）`))
      if (data.status === 'skipped') {
        const messages: Record<string, string> = {
          no_conversation_turns: '这一天没有可用于生成日回顾的对话记录。',
          persona_not_found: '找不到当前协作者配置。',
          model_not_configured: '日回顾模型尚未配置完整。',
          empty_material: '这一天没有可见的对话正文。',
          empty_model_output: '模型没有返回日回顾正文。',
        }
        throw new Error(messages[String(data.reason)] || `未生成：${String(data.reason || '未知原因')}`)
      }
      if (data.status === 'protected') throw new Error('这篇日回顾已手动微调；重新生成前需要确认覆盖。')
      await loadData(personaId)
      selectDate(reviewDate)
      setNotice(data.status === 'exists' ? '这一天已经有日回顾，已为你打开。' : '日回顾已生成。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成失败')
    } finally {
      setGeneratingDate('')
    }
  }

  const regenerate = () => {
    if (!selectedReview) return
    const override = selectedReview.edited_by_user === true
    if (override && !window.confirm('这篇日回顾已经手动微调。重新生成会覆盖你的修改，确定继续吗？')) return
    void generateReview(selectedDate, true, override)
  }

  const saveReview = async () => {
    if (!draft.trim()) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/daily-reviews', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: personaId, review_date: selectedDate, content: draft.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(String(data.error || `保存失败（${response.status}）`))
      setEditing(false)
      setNotice('微调已保存；已经创建的窗口快照不会随之改变。')
      await loadData(personaId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const openBucket = async (id: string) => {
    setBucketEditing(false)
    setDetailLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/bucket/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error(`读取记忆详情失败（${response.status}）`)
      setSelectedBucket(await response.json())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取记忆详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const post = async (url: string, body?: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.detail || data?.error || `操作失败（${response.status}）`)
    }
  }

  const refreshBucket = async (id: string) => {
    await Promise.all([openBucket(id), loadData(personaId)])
  }

  const traceOp = async (id: string, args: Record<string, unknown>) => {
    setOperating(true)
    try {
      await post('/api/edit-bucket', { id, ...args })
      if (args.delete) { setSelectedBucket(null); await loadData(personaId) }
      else await refreshBucket(id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setOperating(false) }
  }

  const saveBucketEdit = async () => {
    if (!selectedBucket) return
    setBucketSaving(true)
    try {
      await post('/api/edit-bucket', { id: selectedBucket.id, content: bucketEditContent })
      setBucketEditing(false)
      await refreshBucket(selectedBucket.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setBucketSaving(false) }
  }

  const runBucketAction = async (id: string, path: string) => {
    setOperating(true)
    try { await post(path); await refreshBucket(id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setOperating(false) }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="mx-auto max-w-2xl px-4 pt-5"><div className="flex items-center justify-between"><SubpageBackButton href="/" label="返回主页" /><div className="relative"><button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="更多操作" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] shadow-[var(--glass-shadow)]">···</button>{menuOpen && <div className="cc-popmenu absolute right-0 top-11 z-20 min-w-40 rounded-[var(--radius-xl)] p-2 text-xs">{personas.length > 1 && <select aria-label="协作者" value={personaId} onChange={event => { setPersonaId(event.target.value); setMenuOpen(false) }} className="w-full rounded-[var(--radius-md)] p-2">{personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name || persona.id}</option>)}</select>}{!loading && selectedDate < today && !selectedReview && <button type="button" disabled={Boolean(generatingDate)} onClick={() => { void generateReview(selectedDate); setMenuOpen(false) }} className="w-full p-2 text-left">补写 {Number(selectedDate.slice(5, 7))}月{Number(selectedDate.slice(8, 10))}日</button>}<button type="button" onClick={() => { setLoading(true); void loadData(personaId).finally(() => setLoading(false)); setMenuOpen(false) }} className="w-full p-2 text-left">刷新</button></div>}</div></div><p className="mt-5 text-xs uppercase tracking-[var(--label-tracking)] text-[var(--color-primary)]">DAYS · 日回顾</p><h1 className="mt-1 font-[var(--font-display)] text-3xl font-normal text-[var(--color-text-heading)]">日回顾</h1><p className="mt-2 text-sm text-[var(--color-text-tertiary)]">每天结束后，写给第二天的自己{personas.length > 1 ? ` · ${personas.find(persona => persona.id === personaId)?.name || personaId}` : ''}</p></header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        <section className="overflow-hidden rounded-[var(--radius-reading-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
          <div className="home-section-heading px-4 pt-4 sm:px-5"><p className="home-kicker">{new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(year, month, 1)).toUpperCase()} · {MONTHS_ZH[month]}{chapters[`${year}-${String(month + 1).padStart(2, '0')}`]?.name ? ` · ${chapters[`${year}-${String(month + 1).padStart(2, '0')}`].name}` : ''}</p><button type="button" onClick={() => setCalendarOpen(!calendarOpen)} className="home-section-link">{calendarOpen ? '收起月历 ⌄' : '展开月历 ›'}</button></div>
          <div className="px-4 pb-3 sm:px-5"><WeekCalendar days={weekCells.map((cell, index) => ({ date: cell.key, label: WEEKDAYS[index], hasReview: reviewDates.has(cell.key), hasMemory: eventDates.has(cell.key) }))} today={today} selectedDate={selectedDate} onSelect={selectDate} highlightSelection disableFuture /></div>
          {calendarOpen && <>
          <div className="flex items-center justify-between border-t border-[var(--color-border-light)] px-4 py-2">
            <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-[var(--color-surface-secondary)]">‹</button>
            <p className="home-kicker">{year} 年 {month + 1} 月</p>
            <button type="button" aria-label="下个月" onClick={() => changeMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-[var(--color-surface-secondary)]">›</button>
          </div>
          <div className="grid grid-cols-7 px-2 pt-3 sm:px-4">{WEEKDAYS.map(day => <div key={day} className="py-2 text-center text-xs text-[var(--color-text-disabled)]">{day}</div>)}</div>
          <div className="grid grid-cols-7 gap-1 p-2 pt-0 sm:gap-2 sm:p-4 sm:pt-0">
            {cells.map(cell => {
              const hasReview = reviewDates.has(cell.key)
              const hasEvent = eventDates.has(cell.key)
              const isSelected = cell.key === selectedDate
              const isToday = cell.key === today
              return <button key={cell.key} type="button" onClick={() => selectDate(cell.key)} disabled={cell.key > today} className={`relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-[var(--radius-lg)] text-sm transition disabled:opacity-35 sm:min-h-16 ${isSelected ? 'bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)]' : cell.inMonth ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]' : 'text-[var(--color-text-disabled)] hover:bg-[var(--color-surface-secondary)]'} ${isToday && !isSelected ? 'ring-1 ring-inset ring-[var(--color-primary)]' : ''}`}>
                <span>{cell.day}</span><span className="mt-1 flex h-1.5 items-center gap-1">{hasReview && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-primary)]'}`} />}{hasEvent && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-[var(--color-surface)]/60' : 'bg-[var(--color-memory-event)]'}`} />}</span>
              </button>
            })}
          </div>
          </>}
        </section>

        <section className="space-y-5">
          {error && <div className="rounded-xl border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</div>}
          {notice && <div className="rounded-xl border border-[var(--color-success-border)] bg-[var(--color-success-bg)] px-4 py-3 text-sm text-[var(--color-success)]">{notice}</div>}
          {loading ? <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-12 text-center text-sm text-[var(--color-text-disabled)]">正在读取…</div> : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between px-1"><div><p className="home-kicker">DAY · 日回顾</p><h2 className="home-diary-title">{selectedLabel}</h2></div>{selectedReview && !editing && <div className="relative"><button type="button" onClick={() => setReviewMenuOpen(!reviewMenuOpen)} className="text-sm">···</button>{reviewMenuOpen && <div className="cc-popmenu absolute right-0 top-6 z-20 min-w-28 rounded-[var(--radius-lg)] p-2"><button type="button" disabled={Boolean(generatingDate)} onClick={() => { regenerate(); setReviewMenuOpen(false) }} className="block px-2 py-1 text-xs">重新生成</button><button type="button" onClick={() => { setEditing(true); setDraft(selectedReview.content); setReviewMenuOpen(false) }} className="block px-2 py-1 text-xs">编辑</button></div>}</div>}</div>
                {selectedReview ? <article className="rounded-[var(--radius-reading-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                  <p className="mb-3 text-2xs text-[var(--color-text-disabled)]">{selectedReview.edited_by_user ? '已手动微调' : '自动生成'}{selectedReview.source_turn_count ? ` · ${selectedReview.source_turn_count} 轮素材` : ''}</p>
                  {editing ? <div><textarea value={draft} onChange={event => setDraft(event.target.value)} rows={8} className="w-full resize-y rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2.5 text-base leading-7 outline-none focus:border-[var(--color-primary)]" /><div className="mt-2 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs">取消</button><button type="button" disabled={saving || !draft.trim()} onClick={() => void saveReview()} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-1.5 text-xs text-[var(--color-on-primary)] disabled:opacity-40">{saving ? '保存中…' : '保存微调'}</button></div></div> : <p className="whitespace-pre-wrap text-md leading-[1.9] text-[var(--color-text-secondary)]">{selectedReview.content}</p>}
                </article> : <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-disabled)]">这一天还没有日回顾{selectedDate < today && <button type="button" onClick={() => void generateReview(selectedDate)} className="ml-2 text-[var(--color-primary)]">补写这一天</button>}</div>}
              </div>
              <div><h3 className="home-kicker mb-2 px-1">SAVED · 那天存下的 · {selectedEvents.length}</h3><div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">{selectedEvents.length > 0 ? selectedEvents.map(bucket => <button key={bucket.id} type="button" onClick={() => void openBucket(bucket.id)} className="flex w-full items-center gap-3 border-b border-[var(--color-border-light)] p-4 text-left last:border-b-0"><span className={`h-2 w-2 shrink-0 rounded-full ${bucket.type === 'feel' || bucket.metadata?.type === 'feel' ? 'bg-[var(--color-feel)]' : 'bg-[var(--color-memory-event)]'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{bucketName(bucket)}</span><span className="text-2xs text-[var(--color-text-tertiary)]">{bucket.type === 'feel' ? '感受' : '记忆事件'}</span></span><span className="text-[var(--color-text-tertiary)]">›</span></button>) : <p className="p-6 text-center text-sm text-[var(--color-text-tertiary)]">这一天没有带日期的记忆事件</p>}</div></div>
            </>
          )}
          <nav className="home-section-heading px-1"><button type="button" onClick={() => selectDate(previousDate(selectedDate))} className="home-section-link py-2">‹ 前一天</button>{selectedDate < today ? <button type="button" onClick={() => selectDate(nextDate(selectedDate))} className="home-section-link py-2">后一天 ›</button> : <span />}</nav>
        </section>
      </main>

      <BucketDetailDrawer selected={selectedBucket} detailLoading={detailLoading} editing={bucketEditing} editContent={bucketEditContent} saving={bucketSaving} operating={operating} copied={copied} onClose={() => { setSelectedBucket(null); setBucketEditing(false) }} onStartEdit={content => { setBucketEditing(true); setBucketEditContent(content) }} onCancelEdit={() => setBucketEditing(false)} onSaveEdit={saveBucketEdit} onTraceOp={traceOp} onCopyId={() => { if (!selectedBucket) return; navigator.clipboard.writeText(selectedBucket.id); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }} onTouch={id => runBucketAction(id, `/api/touch/${encodeURIComponent(id)}`)} onArchive={id => runBucketAction(id, `${selectedBucket?.metadata.type === 'archived' ? '/api/unarchive/' : '/api/archive/'}${encodeURIComponent(id)}`)} onActivate={id => runBucketAction(id, `/api/touch/${encodeURIComponent(id)}?ripple=true`)} />
    </div>
  )
}
