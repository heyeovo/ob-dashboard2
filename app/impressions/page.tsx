'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import BucketDetailDrawer from '../components/BucketDetailDrawer'

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

function dateKey(value?: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : DATE_FORMATTER.format(parsed)
}

function bucketMetadata(bucket: BucketListItem) {
  return bucket.metadata && typeof bucket.metadata === 'object' ? bucket.metadata : {}
}

function bucketTags(bucket: BucketListItem): string[] {
  const metadataTags = bucketMetadata(bucket).tags
  const tags = Array.isArray(bucket.tags) ? bucket.tags : Array.isArray(metadataTags) ? metadataTags : []
  return tags.map(String)
}

function isLegacyDailyImpression(bucket: BucketListItem): boolean {
  const metadata = bucketMetadata(bucket)
  const marker = metadata.daily_impression
  return bucketTags(bucket).some(tag => tag.toLowerCase() === 'daily_impression')
    || marker === true
    || marker === 1
    || (typeof marker === 'string' && ['true', '1', 'daily_impression'].includes(marker.toLowerCase()))
    || String(metadata.type ?? bucket.type ?? '').toLowerCase() === 'daily_impression'
}

function bucketDate(bucket: BucketListItem) {
  const metadata = bucketMetadata(bucket)
  return dateKey(bucket.event_time ?? metadata.event_time ?? bucket.created ?? metadata.created)
}

function bucketName(bucket: BucketListItem) {
  return bucket.name || String(bucketMetadata(bucket).name || '') || bucket.id
}

function bucketContent(bucket: BucketListItem) {
  const metadata = bucketMetadata(bucket)
  return bucket.content_preview || String(metadata.content_preview || metadata.content || '')
}

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

export default function DailyReviewsPage() {
  const today = DATE_FORMATTER.format(new Date())
  const yesterday = previousDate(today)
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1)
  const [selectedDate, setSelectedDate] = useState(today)
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

  const generateYesterday = () => {
    selectDate(yesterday)
    if (reviewMap.has(yesterday)) {
      setNotice('昨天已经有日回顾，已为你打开。')
      return
    }
    void generateReview(yesterday)
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
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-tertiary)] hover:bg-black/5">← Home</Link>
            <div><h1 className="text-base font-semibold">日回顾</h1><p className="hidden text-xs text-[var(--color-text-disabled)] sm:block">从月历回看连续性笔记与当天发生的事</p></div>
          </div>
          <div className="flex items-center gap-2">
            {personas.length > 1 && <select value={personaId} onChange={event => setPersonaId(event.target.value)} className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs">{personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name || persona.id}</option>)}</select>}
            <button type="button" disabled={Boolean(generatingDate)} onClick={generateYesterday} className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white disabled:opacity-50">{generatingDate === yesterday ? '生成中…' : reviewMap.has(yesterday) ? '查看昨天' : '生成昨天'}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-3 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] lg:py-8">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-4 py-4 sm:px-5">
            <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-[var(--color-surface-secondary)]">‹</button>
            <h2 className="font-semibold">{year} 年 {month + 1} 月</h2>
            <button type="button" aria-label="下个月" onClick={() => changeMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-[var(--color-surface-secondary)]">›</button>
          </div>
          <div className="grid grid-cols-7 px-2 pt-3 sm:px-4">{WEEKDAYS.map(day => <div key={day} className="py-2 text-center text-xs text-[var(--color-text-disabled)]">{day}</div>)}</div>
          <div className="grid grid-cols-7 gap-1 p-2 pt-0 sm:gap-2 sm:p-4 sm:pt-0">
            {cells.map(cell => {
              const hasReview = reviewDates.has(cell.key)
              const hasEvent = eventDates.has(cell.key)
              const isSelected = cell.key === selectedDate
              const isToday = cell.key === today
              return <button key={cell.key} type="button" onClick={() => selectDate(cell.key)} className={`relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-xl text-sm transition sm:min-h-16 ${isSelected ? 'bg-[var(--color-primary)] font-semibold text-white shadow-sm' : cell.inMonth ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]' : 'text-[var(--color-text-disabled)] hover:bg-[var(--color-surface-secondary)]'} ${isToday && !isSelected ? 'ring-1 ring-inset ring-[var(--color-primary)]' : ''}`}>
                <span>{cell.day}</span><span className="mt-1 flex h-1.5 items-center gap-1">{hasReview && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-[var(--color-primary)]'}`} />}{hasEvent && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white/60' : 'bg-[#8AA4A0]'}`} />}</span>
              </button>
            })}
          </div>
          <div className="flex items-center justify-center gap-5 border-t border-[var(--color-border-light)] px-4 py-3 text-xs text-[var(--color-text-tertiary)]"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />日回顾</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#8AA4A0]" />记忆事件</span></div>
        </section>

        <section className="space-y-5">
          <div className="flex items-center justify-between px-1"><div><h2 className="text-lg font-semibold">{selectedDate}</h2><p className="text-xs text-[var(--color-text-disabled)]">{selectedReview ? '1 篇日回顾' : '暂无日回顾'} · {selectedEvents.length} 件记忆事件</p></div><button type="button" onClick={() => { setLoading(true); loadData(personaId).catch(reason => setError(reason instanceof Error ? reason.message : '刷新失败')).finally(() => setLoading(false)) }} className="text-xs text-[var(--color-primary)]">刷新</button></div>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
          {loading ? <div className="rounded-2xl border border-[var(--color-border)] bg-white px-5 py-12 text-center text-sm text-[var(--color-text-disabled)]">正在读取…</div> : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between px-1"><h3 className="text-sm font-semibold">当日日回顾</h3>{selectedReview && !editing && <div className="flex gap-3"><button type="button" disabled={Boolean(generatingDate)} onClick={regenerate} className="text-xs text-[var(--color-text-tertiary)]">{generatingDate === selectedDate ? '生成中…' : '重新生成'}</button><button type="button" onClick={() => { setEditing(true); setDraft(selectedReview.content) }} className="text-xs text-[var(--color-primary)]">微调</button></div>}</div>
                {selectedReview ? <article className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                  <p className="mb-3 text-[10.5px] text-[var(--color-text-disabled)]">{selectedReview.edited_by_user ? '已手动微调' : '自动生成'}{selectedReview.source_turn_count ? ` · ${selectedReview.source_turn_count} 轮素材` : ''}</p>
                  {editing ? <div><textarea value={draft} onChange={event => setDraft(event.target.value)} rows={8} className="w-full resize-y rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm leading-7 outline-none focus:border-[var(--color-primary)]" /><div className="mt-2 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs">取消</button><button type="button" disabled={saving || !draft.trim()} onClick={() => void saveReview()} className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white disabled:opacity-40">{saving ? '保存中…' : '保存微调'}</button></div></div> : <p className="whitespace-pre-wrap text-[14px] leading-7 text-[var(--color-text-secondary)]">{selectedReview.content}</p>}
                </article> : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-disabled)]">这一天还没有日回顾{selectedDate === yesterday && <button type="button" onClick={() => void generateReview(selectedDate)} className="ml-2 text-[var(--color-primary)]">立即生成</button>}</div>}
              </div>
              <div><h3 className="mb-2 px-1 text-sm font-semibold">当天发生了什么</h3><div className="space-y-2">{selectedEvents.length > 0 ? selectedEvents.map(bucket => <button key={bucket.id} type="button" onClick={() => void openBucket(bucket.id)} className="w-full rounded-xl border border-[var(--color-border)] bg-white p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm"><div className="mb-2 flex items-center justify-between gap-3"><span className="font-medium text-[var(--color-text-primary)]">{bucketName(bucket)}</span><span className="shrink-0 rounded-full bg-[var(--color-surface-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">记忆事件</span></div><p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{bucketContent(bucket) || '点击查看记忆详情'}</p></button>) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-disabled)]">这一天没有带日期的记忆事件</div>}</div></div>
            </>
          )}
        </section>
      </main>

      <BucketDetailDrawer selected={selectedBucket} detailLoading={detailLoading} editing={bucketEditing} editContent={bucketEditContent} saving={bucketSaving} operating={operating} copied={copied} onClose={() => { setSelectedBucket(null); setBucketEditing(false) }} onStartEdit={content => { setBucketEditing(true); setBucketEditContent(content) }} onCancelEdit={() => setBucketEditing(false)} onSaveEdit={saveBucketEdit} onTraceOp={traceOp} onCopyId={() => { if (!selectedBucket) return; navigator.clipboard.writeText(selectedBucket.id); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }} onTouch={id => runBucketAction(id, `/api/touch/${encodeURIComponent(id)}`)} onArchive={id => runBucketAction(id, `${selectedBucket?.metadata.type === 'archived' ? '/api/unarchive/' : '/api/archive/'}${encodeURIComponent(id)}`)} onActivate={id => runBucketAction(id, `/api/touch/${encodeURIComponent(id)}?ripple=true`)} />
    </div>
  )
}
