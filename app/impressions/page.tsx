'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import BucketDetailDrawer from '../components/BucketDetailDrawer'

interface BucketListItem {
  id: string
  name?: string
  type?: string
  tags?: string[]
  created?: string
  event_time?: string
  content_preview?: string
  metadata?: Record<string, unknown>
}

interface BucketDetail {
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

interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function dateKey(value?: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : DATE_FORMATTER.format(parsed)
}

function bucketMetadata(bucket: BucketListItem): Record<string, unknown> {
  return bucket.metadata && typeof bucket.metadata === 'object' ? bucket.metadata : {}
}

function bucketTags(bucket: BucketListItem): string[] {
  const metadataTags = bucketMetadata(bucket).tags
  const tags = Array.isArray(bucket.tags) ? bucket.tags : Array.isArray(metadataTags) ? metadataTags : []
  return tags.map(String)
}

function isDailyImpression(bucket: BucketListItem): boolean {
  const metadata = bucketMetadata(bucket)
  const marker = metadata.daily_impression
  return bucketTags(bucket).some(tag => tag.toLowerCase() === 'daily_impression')
    || marker === true
    || marker === 1
    || (typeof marker === 'string' && ['true', '1', 'daily_impression'].includes(marker.toLowerCase()))
    || String(metadata.type ?? bucket.type ?? '').toLowerCase() === 'daily_impression'
}

function bucketDate(bucket: BucketListItem): string | null {
  const metadata = bucketMetadata(bucket)
  return dateKey(bucket.event_time ?? metadata.event_time ?? bucket.created ?? metadata.created)
}

function bucketName(bucket: BucketListItem): string {
  return bucket.name || String(bucketMetadata(bucket).name || '') || bucket.id
}

function bucketContent(bucket: BucketListItem): string {
  const metadata = bucketMetadata(bucket)
  return bucket.content_preview || String(metadata.content_preview || metadata.content || '')
}

function collectSourceIds(bucket: BucketListItem): string[] {
  const metadata = bucketMetadata(bucket)
  const candidates = [
    metadata.source_memory_ids,
    metadata.source_ids,
    metadata.source_memories,
    metadata.sources,
    metadata.related,
  ]
  const ids = new Set<string>()

  for (const candidate of candidates) {
    if (!candidate) continue
    const values = Array.isArray(candidate) ? candidate : [candidate]
    for (const value of values) {
      if (typeof value === 'string') {
        value.split(',').map(part => part.trim()).filter(Boolean).forEach(id => ids.add(id))
      } else if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>
        const id = item.id ?? item.bucket_id ?? item.memory_id
        if (typeof id === 'string' && id) ids.add(id)
      }
    }
  }

  return [...ids]
}

function shortTermRounds(bucket: BucketListItem): unknown {
  const metadata = bucketMetadata(bucket)
  return metadata.short_term_rounds
    ?? metadata.short_term_turns
    ?? metadata.recent_turns
    ?? metadata.conversation_rounds
    ?? metadata.source_rounds
    ?? null
}

function formatRound(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function makeCalendar(year: number, month: number): CalendarCell[] {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const previousMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: CalendarCell[] = []

  for (let index = 0; index < 42; index += 1) {
    const offsetDay = index - firstWeekday + 1
    if (offsetDay < 1) {
      const day = previousMonthDays + offsetDay
      const previous = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
      cells.push({ key: `${previous.year}-${String(previous.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day, inMonth: false })
    } else if (offsetDay > daysInMonth) {
      const day = offsetDay - daysInMonth
      const next = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
      cells.push({ key: `${next.year}-${String(next.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day, inMonth: false })
    } else {
      cells.push({ key: `${year}-${String(month + 1).padStart(2, '0')}-${String(offsetDay).padStart(2, '0')}`, day: offsetDay, inMonth: true })
    }
  }
  return cells
}

export default function ImpressionsPage() {
  const now = new Date()
  const today = DATE_FORMATTER.format(now)
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [buckets, setBuckets] = useState<BucketListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadBuckets = useCallback(async (signal?: AbortSignal) => {
    setError('')
    const response = await fetch(`/api/buckets?full=1&_t=${Date.now()}`, { signal })
    if (!response.ok) throw new Error(`读取记忆失败（${response.status}）`)
    const data = await response.json()
    setBuckets(Array.isArray(data) ? data : (data.buckets || []))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve()
      .then(() => loadBuckets(controller.signal))
      .catch(reason => {
        if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取记忆失败')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadBuckets])

  const cells = useMemo(() => makeCalendar(year, month), [year, month])
  const dailyBuckets = useMemo(() => buckets.filter(isDailyImpression), [buckets])
  const eventBuckets = useMemo(() => buckets.filter(bucket => !isDailyImpression(bucket)), [buckets])
  const impressionDates = useMemo(() => new Set(dailyBuckets.map(bucketDate).filter((value): value is string => Boolean(value))), [dailyBuckets])
  const eventDates = useMemo(() => new Set(eventBuckets.map(bucketDate).filter((value): value is string => Boolean(value))), [eventBuckets])
  const selectedImpressions = useMemo(() => dailyBuckets.filter(bucket => bucketDate(bucket) === selectedDate), [dailyBuckets, selectedDate])
  const selectedEvents = useMemo(() => eventBuckets.filter(bucket => bucketDate(bucket) === selectedDate), [eventBuckets, selectedDate])
  const bucketMap = useMemo(() => new Map(buckets.map(bucket => [bucket.id, bucket])), [buckets])

  const changeMonth = (offset: number) => {
    const next = new Date(Date.UTC(year, month + offset, 1))
    const nextYear = next.getUTCFullYear()
    const nextMonth = next.getUTCMonth()
    setYear(nextYear)
    setMonth(nextMonth)
    setSelectedDate(`${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`)
  }

  const goToday = () => {
    setYear(Number(today.slice(0, 4)))
    setMonth(Number(today.slice(5, 7)) - 1)
    setSelectedDate(today)
  }

  const openBucket = async (id: string) => {
    setEditing(false)
    setDetailLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/bucket/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error(`读取记忆详情失败（${response.status}）`)
      setSelected(await response.json())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取记忆详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshSelected = async (id: string) => {
    await Promise.all([openBucket(id), loadBuckets()])
  }

  const post = async (url: string, body?: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.detail || data?.error || `操作失败（${response.status}）`)
    }
  }

  const traceOp = async (id: string, args: Record<string, unknown>) => {
    setOperating(true)
    setError('')
    try {
      await post('/api/edit-bucket', { id, ...args })
      if (args.delete) {
        setSelected(null)
        await loadBuckets()
      } else {
        await refreshSelected(id)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setOperating(false)
    }
  }

  const saveEdit = async () => {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      await post('/api/edit-bucket', { id: selected.id, content: editContent })
      setEditing(false)
      await refreshSelected(selected.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const runBucketAction = async (id: string, path: string) => {
    setOperating(true)
    setError('')
    try {
      await post(path)
      await refreshSelected(id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setOperating(false)
    }
  }

  const renderBucketButton = (bucket: BucketListItem, kind: 'impression' | 'event') => (
    <button
      key={bucket.id}
      type="button"
      onClick={() => openBucket(bucket.id)}
      className="w-full rounded-xl border border-[var(--color-border)] bg-white p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-medium text-[var(--color-text-primary)]">{bucketName(bucket)}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${kind === 'impression' ? 'bg-[#F8E9E3] text-[var(--color-primary)]' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]'}`}>
          {kind === 'impression' ? '日印象' : '记忆事件'}
        </span>
      </div>
      <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {bucketContent(bucket) || '点击查看记忆详情'}
      </p>
    </button>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-tertiary)] hover:bg-black/5">← Home</Link>
            <div>
              <h1 className="text-base font-semibold">日印象</h1>
              <p className="hidden text-xs text-[var(--color-text-disabled)] sm:block">从月历回看当天留下的印象与记忆</p>
            </div>
          </div>
          <button type="button" onClick={goToday} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]">今天</button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-3 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] lg:py-8">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-4 py-4 sm:px-5">
            <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]">‹</button>
            <h2 className="font-semibold">{year} 年 {month + 1} 月</h2>
            <button type="button" aria-label="下个月" onClick={() => changeMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]">›</button>
          </div>

          <div className="grid grid-cols-7 px-2 pt-3 sm:px-4">
            {WEEKDAYS.map(day => <div key={day} className="py-2 text-center text-xs text-[var(--color-text-disabled)]">{day}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1 p-2 pt-0 sm:gap-2 sm:p-4 sm:pt-0">
            {cells.map(cell => {
              const hasImpression = impressionDates.has(cell.key)
              const hasEvent = eventDates.has(cell.key)
              const isSelected = cell.key === selectedDate
              const isToday = cell.key === today
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => {
                    setSelectedDate(cell.key)
                    if (!cell.inMonth) {
                      setYear(Number(cell.key.slice(0, 4)))
                      setMonth(Number(cell.key.slice(5, 7)) - 1)
                    }
                  }}
                  className={`relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-xl text-sm transition sm:min-h-16 ${
                    isSelected
                      ? 'bg-[var(--color-primary)] font-semibold text-white shadow-sm'
                      : cell.inMonth
                        ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]'
                        : 'text-[var(--color-text-disabled)] hover:bg-[var(--color-surface-secondary)]'
                  } ${isToday && !isSelected ? 'ring-1 ring-inset ring-[var(--color-primary)]' : ''}`}
                >
                  <span>{cell.day}</span>
                  <span className="mt-1 flex h-1.5 items-center gap-1">
                    {hasImpression && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-[var(--color-primary)]'}`} />}
                    {hasEvent && <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white/60' : 'bg-[#8AA4A0]'}`} />}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-5 border-t border-[var(--color-border-light)] px-4 py-3 text-xs text-[var(--color-text-tertiary)]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />日印象</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#8AA4A0]" />记忆事件</span>
          </div>
        </section>

        <section className="space-y-5">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-lg font-semibold">{selectedDate}</h2>
              <p className="text-xs text-[var(--color-text-disabled)]">{selectedImpressions.length} 条日印象 · {selectedEvents.length} 件记忆事件</p>
            </div>
            <button type="button" onClick={() => { setLoading(true); loadBuckets().catch(reason => setError(reason instanceof Error ? reason.message : '刷新失败')).finally(() => setLoading(false)) }} className="text-xs text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]">刷新</button>
          </div>

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="shrink-0">关闭</button>
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-[var(--color-border)] bg-white px-5 py-12 text-center text-sm text-[var(--color-text-disabled)]">正在读取日印象…</div>
          ) : (
            <>
              <div>
                <h3 className="mb-2 px-1 text-sm font-semibold">当日日印象</h3>
                <div className="space-y-2">
                  {selectedImpressions.length > 0
                    ? selectedImpressions.map(bucket => renderBucketButton(bucket, 'impression'))
                    : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-disabled)]">这一天还没有日印象</div>}
                </div>
              </div>

              {selectedImpressions.map(impression => {
                const sourceIds = collectSourceIds(impression)
                const rounds = shortTermRounds(impression)
                if (sourceIds.length === 0 && rounds == null) return null
                return (
                  <div key={`${impression.id}-sources`} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
                    <h3 className="mb-3 text-sm font-semibold">来源 · {bucketName(impression)}</h3>
                    {sourceIds.length > 0 && (
                      <div className="mb-4">
                        <p className="mb-2 text-xs text-[var(--color-text-disabled)]">来源记忆</p>
                        <div className="flex flex-wrap gap-2">
                          {sourceIds.map(id => {
                            const source = bucketMap.get(id)
                            return <button key={id} type="button" onClick={() => openBucket(id)} className="max-w-full truncate rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-left text-xs text-[var(--color-primary)] hover:border-[var(--color-primary)]">{source ? bucketName(source) : id}</button>
                          })}
                        </div>
                      </div>
                    )}
                    {rounds != null && (
                      <div>
                        <p className="mb-2 text-xs text-[var(--color-text-disabled)]">短期轮次</p>
                        <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">{formatRound(rounds)}</pre>
                      </div>
                    )}
                  </div>
                )
              })}

              <div>
                <h3 className="mb-2 px-1 text-sm font-semibold">当天发生了什么</h3>
                <div className="space-y-2">
                  {selectedEvents.length > 0
                    ? selectedEvents.map(bucket => renderBucketButton(bucket, 'event'))
                    : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-text-disabled)]">这一天没有带日期的记忆事件</div>}
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      <BucketDetailDrawer
        selected={selected}
        detailLoading={detailLoading}
        editing={editing}
        editContent={editContent}
        saving={saving}
        operating={operating}
        copied={copied}
        onClose={() => { setSelected(null); setEditing(false) }}
        onStartEdit={content => { setEditing(true); setEditContent(content) }}
        onCancelEdit={() => setEditing(false)}
        onSaveEdit={saveEdit}
        onTraceOp={traceOp}
        onCopyId={() => {
          if (!selected) return
          navigator.clipboard.writeText(selected.id)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }}
        onTouch={id => runBucketAction(id, `/api/touch/${encodeURIComponent(id)}`)}
        onArchive={id => runBucketAction(id, `${selected?.metadata.type === 'archived' ? '/api/unarchive/' : '/api/archive/'}${encodeURIComponent(id)}`)}
        onActivate={id => runBucketAction(id, `/api/touch/${encodeURIComponent(id)}?ripple=true`)}
      />
    </div>
  )
}
