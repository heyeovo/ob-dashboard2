'use client'
import { useEffect, useState, useCallback } from 'react'
import { FilterPill } from '../components/FilterBar'

type Bucket = {
  id: string
  name: string
  content_preview?: string
  importance?: number
  score?: number
  tags?: string[]
  created?: string
}

type FullBucket = Bucket & {
  content?: string
}

type Status = '已精修' | '存疑' | null

export default function ReviewPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})
  const [statesBucketId, setStatesBucketId] = useState('')
  const [filter, setFilter] = useState<'待办' | '存疑' | '已精修' | '全部'>('待办')
  const [timeFilter, setTimeFilter] = useState<'今天' | '全部'>('全部')
  const [current, setCurrent] = useState(0)
  const [fullBucket, setFullBucket] = useState<FullBucket | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [categories, setCategories] = useState<string[]>([])
  const [newCatInput, setNewCatInput] = useState('')

  useEffect(() => {
    async function load() {
      const [stateRes, bucketsRes] = await Promise.all([
        fetch('/api/review-status').then(r => r.json()),
        fetch('/api/buckets').then(r => r.json()),
      ])
      setStatusMap(stateRes.statusMap ?? {})
      setStatesBucketId(stateRes.bucketId ?? '')
      setBuckets(bucketsRes ?? [])
      setLoading(false)
      setCategoryMap(stateRes.categoryMap ?? {})
      setCategories(stateRes.categories ?? [])
    }
    load()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const queue = buckets.filter(b => {
    if (b.name === '__review_state__') return false
    const s = statusMap[b.id] ?? null
    const timeOk = timeFilter === '全部' || (b.created ?? '').startsWith(today)
    if (filter === '待办') return s === null && timeOk
    if (filter === '存疑') return s === '存疑' && timeOk
    if (filter === '已精修') return s === '已精修' && timeOk
    return timeOk
  })

  const counts = {
    待办: buckets.filter(b => !statusMap[b.id]).length,
    存疑: buckets.filter(b => statusMap[b.id] === '存疑').length,
    已精修: buckets.filter(b => statusMap[b.id] === '已精修').length,
  }

  useEffect(() => {
    const b = queue[current]
    if (!b) { setFullBucket(null); return }
    setFullBucket(null)
    fetch(`/api/bucket/${b.id}`).then(r => r.json()).then(setFullBucket)
  }, [current, filter, timeFilter, statusMap])

  const updateStatus = useCallback(async (targetId: string, status: Status) => {
    setSaving(true)
    const newMap = { ...statusMap }
    if (status === null) delete newMap[targetId]
    else newMap[targetId] = status
    setStatusMap(newMap)

    await fetch('/api/review-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statesBucketId, targetId, status }),
    })
    setSaving(false)
    if (filter !== '全部') setCurrent(c => Math.max(0, Math.min(c, queue.length - 2)))
  }, [statusMap, statesBucketId, filter, queue.length])

  const updateCategory = useCallback(async (targetId: string, category: string | null, isNew = false) => {
    const newMap = { ...categoryMap }
    if (category === null) delete newMap[targetId]
    else newMap[targetId] = category
    setCategoryMap(newMap)

    const body: Record<string, unknown> = { statesBucketId, targetId, category }
    if (isNew && category) {
      body.newCategory = category
      setCategories(prev => prev.includes(category) ? prev : [...prev, category])
    }
    await fetch('/api/review-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }, [categoryMap, statesBucketId])

  const getContent = (b: FullBucket | null) => {
    if (!b) return ''
    return b.content ?? ''
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[var(--color-bg)] text-[var(--color-text-tertiary)]">
      <span>加载中...</span>
    </div>
  )

  const cur = queue[current]

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans selection:bg-[var(--color-primary)] selection:text-white">
      {queue.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 text-xs text-[var(--color-text-disabled)]">
          ← <a href="/memory" className="hover:text-[var(--color-text-primary)]">返回</a> · {current + 1}/{queue.length}
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-20">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6 sm:mb-8">
          <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
            {(['待办', '存疑', '已精修', '全部'] as const).map(f => {
              const DOTS: Record<string, string> = { 待办: 'text-yellow-500', 存疑: 'text-red-500', 已精修: 'text-green-600', 全部: 'text-[var(--color-text-disabled)]' }
              return (
                <FilterPill key={f} label={f} active={filter === f} onClick={() => { setFilter(f); setCurrent(0) }}
                  className="flex items-center gap-1">
                  <span className={DOTS[f]}>●</span>
                  <span className="text-[var(--color-text-disabled)]">{f !== '全部' ? counts[f as keyof typeof counts] : buckets.length}</span>
                </FilterPill>
              )
            })}
          </div>

          <div className="flex gap-1.5 sm:gap-2 ml-auto">
            {(['今天', '全部'] as const).map(t => (
              <button key={t} onClick={() => { setTimeFilter(t); setCurrent(0) }}
                className={`text-xs px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                  timeFilter === t
                    ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                    : 'bg-white border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {!cur ? (
          <div className="text-center text-[var(--color-text-disabled)] py-20 text-sm bg-white rounded-2xl border border-[var(--color-border)] border-dashed">
            {filter === '待办' ? '🎉 全部审阅完啦' : '这里什么都没有'}
          </div>
        ) : (
          <div className="bg-white border border-[var(--color-border)] rounded-2xl p-4 sm:p-6 shadow-sm mb-5 sm:mb-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4 text-xs text-[var(--color-text-disabled)]">
              <span>{cur.created?.slice(0, 10) || '未知日期'}</span>
              <div className="flex items-center gap-2 sm:gap-3">
                {statusMap[cur.id] && (
                  <span className={`px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    statusMap[cur.id] === '已精修' 
                      ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' 
                      : 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]'
                  }`}>
                    {statusMap[cur.id]}
                  </span>
                )}
                <span>imp {cur.importance ?? '—'}</span>
                {cur.score != null && <span className="text-[var(--color-primary)] font-medium">score {cur.score}</span>}
              </div>
            </div>

            {cur.tags && cur.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 sm:gap-1.5 mb-3 sm:mb-4">
                {cur.tags.map(t => (
                  <span key={t} className="text-xs px-2 sm:px-2.5 py-0.5 rounded-full bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <h2 className="text-lg sm:text-xl font-semibold text-[var(--color-text-heading)] mb-3 sm:mb-4">{cur.name}</h2>

            <div className="text-[var(--color-text-primary)] text-sm leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto bg-[var(--color-surface-elevated)] rounded-xl p-4 sm:p-5 border border-[var(--color-border-light)]">
              {fullBucket ? getContent(fullBucket) : <span className="text-[var(--color-text-disabled)] italic">加载中…</span>}
            </div>

            <div className="mt-4 sm:mt-5 flex gap-2 items-center">
              <select
                value={categoryMap[cur.id] ?? ''}
                onChange={e => updateCategory(cur.id, e.target.value || null)}
                className="flex-1 bg-white text-[var(--color-text-primary)] text-xs sm:text-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-colors"
              >
                <option value="">— 选择分类 —</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                placeholder="新分类…"
                value={newCatInput}
                onChange={e => setNewCatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCatInput.trim()) {
                    updateCategory(cur.id, newCatInput.trim(), true)
                    setNewCatInput('')
                  }
                }}
                className="w-24 sm:w-32 bg-white text-[var(--color-text-primary)] text-xs sm:text-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-primary)] placeholder-[var(--color-text-disabled)] transition-colors"
              />
            </div>
          </div>
        )}

        {cur && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5 sm:mb-6">
            <button onClick={() => updateStatus(cur.id, '已精修')} disabled={saving}
              className="py-2.5 sm:py-3 rounded-xl bg-[var(--color-digested-bg)] border border-[var(--color-digested-border)] text-[var(--color-digested)] hover:bg-[var(--color-digested-hover)] transition-colors text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              ✓ 已阅
            </button>
            <button onClick={() => updateStatus(cur.id, '存疑')} disabled={saving}
              className="py-2.5 sm:py-3 rounded-xl bg-[var(--color-pending-bg)] border border-[var(--color-pending-border)] text-[var(--color-pending)] hover:bg-[var(--color-pending-hover)] transition-colors text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              ? 存疑
            </button>
            <button onClick={() => updateStatus(cur.id, null)} disabled={saving}
              className="py-2.5 sm:py-3 rounded-xl bg-[var(--color-surface-tertiary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              ↺ 重置
            </button>
            <a href={`/bucket/${cur.id}`}
              className="py-2.5 sm:py-3 rounded-xl bg-[var(--color-resolved-bg)] border border-[var(--color-resolved-border)] text-[var(--color-resolved)] hover:bg-[var(--color-resolved-hover)] transition-colors text-xs sm:text-sm font-semibold text-center"
            >
              ✎ 编辑
            </a>
          </div>
        )}

        {queue.length > 1 && (
          <div className="flex justify-between">
            <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
              className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-40 text-xs sm:text-sm transition-colors"
            >
              ← 上一条
            </button>
            <button onClick={() => setCurrent(c => Math.min(queue.length - 1, c + 1))} disabled={current === queue.length - 1}
              className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-40 text-xs sm:text-sm transition-colors"
            >
              下一条 →
            </button>
          </div>
        )}
      </main>
    </div>
  )
}