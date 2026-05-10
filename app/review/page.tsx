'use client'
import { useEffect, useState, useCallback } from 'react'

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
  content?: { raw?: string } | string
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
    if (typeof b.content === 'string') return b.content
    return b.content?.raw ?? ''
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[#FCFAF8] text-[#8A8681]">
      <span>加载中...</span>
    </div>
  )

  const cur = queue[current]

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans selection:bg-[#D97757] selection:text-white">
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-[#8A8681]">
          <a href="/" className="hover:text-[#3A3836] transition-colors flex items-center gap-1">
            ← 返回
          </a>
          <span className="text-[#3A3836] font-semibold whitespace-nowrap">审阅 · REVIEW</span>
          {queue.length > 0 && (
            <span className="text-[#A8A49D] text-xs ml-auto">
              {current + 1}/{queue.length}
            </span>
          )}
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-20">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-6 sm:mb-8">
          <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
            {(['待办', '存疑', '已精修', '全部'] as const).map(f => (
              <button key={f} onClick={() => { setFilter(f); setCurrent(0) }}
                className={`flex items-center gap-1 sm:gap-1.5 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full border transition-all whitespace-nowrap ${
                  filter === f
                    ? 'bg-[#3A3836] border-[#3A3836] text-white'
                    : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] hover:border-[#C4C1BC]'
                }`}
              >
                <span className={
                  f === '待办' ? 'text-yellow-500' :
                  f === '存疑' ? 'text-red-500' :
                  f === '已精修' ? 'text-green-600' : 'text-[#A8A49D]'
                }>●</span>
                {f}{' '}
                <span className="text-[#A8A49D]">
                  {f !== '全部' ? counts[f as keyof typeof counts] : buckets.length}
                </span>
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 sm:gap-2 ml-auto">
            {(['今天', '全部'] as const).map(t => (
              <button key={t} onClick={() => { setTimeFilter(t); setCurrent(0) }}
                className={`text-xs px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                  timeFilter === t
                    ? 'bg-[#D97757] border-[#D97757] text-white'
                    : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {!cur ? (
          <div className="text-center text-[#A8A49D] py-20 text-sm bg-white rounded-2xl border border-[#E8E6E1] border-dashed">
            {filter === '待办' ? '🎉 全部审阅完啦' : '这里什么都没有'}
          </div>
        ) : (
          <div className="bg-white border border-[#E8E6E1] rounded-2xl p-4 sm:p-6 shadow-sm mb-5 sm:mb-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4 text-xs text-[#A8A49D]">
              <span>{cur.created?.slice(0, 10) || '未知日期'}</span>
              <div className="flex items-center gap-2 sm:gap-3">
                {statusMap[cur.id] && (
                  <span className={`px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    statusMap[cur.id] === '已精修' 
                      ? 'bg-[#EAF5E9] text-[#478B4A]' 
                      : 'bg-[#FDF3E4] text-[#C97E2C]'
                  }`}>
                    {statusMap[cur.id]}
                  </span>
                )}
                <span>imp {cur.importance ?? '—'}</span>
                {cur.score != null && <span className="text-[#D97757] font-medium">score {cur.score}</span>}
              </div>
            </div>

            {cur.tags && cur.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 sm:gap-1.5 mb-3 sm:mb-4">
                {cur.tags.map(t => (
                  <span key={t} className="text-xs px-2 sm:px-2.5 py-0.5 rounded-full bg-[#F4F2EC] text-[#5B5854] border border-[#E8E6E1]">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <h2 className="text-lg sm:text-xl font-semibold text-[#2B2927] mb-3 sm:mb-4">{cur.name}</h2>

            <div className="text-[#3A3836] text-sm leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto bg-[#FDFCFB] rounded-xl p-4 sm:p-5 border border-[#F0EFEB]">
              {fullBucket ? getContent(fullBucket) : <span className="text-[#A8A49D] italic">加载中…</span>}
            </div>

            <div className="mt-4 sm:mt-5 flex gap-2 items-center">
              <select
                value={categoryMap[cur.id] ?? ''}
                onChange={e => updateCategory(cur.id, e.target.value || null)}
                className="flex-1 bg-white text-[#3A3836] text-xs sm:text-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border border-[#E8E6E1] outline-none focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]/10 transition-colors"
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
                className="w-24 sm:w-32 bg-white text-[#3A3836] text-xs sm:text-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border border-[#E8E6E1] outline-none focus:border-[#D97757] placeholder-[#A8A49D] transition-colors"
              />
            </div>
          </div>
        )}

        {cur && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5 sm:mb-6">
            <button onClick={() => updateStatus(cur.id, '已精修')} disabled={saving}
              className="py-2.5 sm:py-3 rounded-xl bg-[#EAF5E9] border border-[#C5E0C3] text-[#478B4A] hover:bg-[#D4EAD2] transition-colors text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              ✓ 已阅
            </button>
            <button onClick={() => updateStatus(cur.id, '存疑')} disabled={saving}
              className="py-2.5 sm:py-3 rounded-xl bg-[#FDF3E4] border border-[#F2D9B6] text-[#C97E2C] hover:bg-[#FBE9D0] transition-colors text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              ? 存疑
            </button>
            <button onClick={() => updateStatus(cur.id, null)} disabled={saving}
              className="py-2.5 sm:py-3 rounded-xl bg-[#F4F2EC] border border-[#E8E6E1] text-[#6C6965] hover:bg-[#E8E4DC] transition-colors text-xs sm:text-sm font-semibold disabled:opacity-50"
            >
              ↺ 重置
            </button>
            <a href={`/bucket/${cur.id}`}
              className="py-2.5 sm:py-3 rounded-xl bg-[#EDF4FC] border border-[#C8DAF0] text-[#3B72B9] hover:bg-[#E0ECF8] transition-colors text-xs sm:text-sm font-semibold text-center"
            >
              ✎ 编辑
            </a>
          </div>
        )}

        {queue.length > 1 && (
          <div className="flex justify-between">
            <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
              className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] disabled:opacity-40 text-xs sm:text-sm transition-colors"
            >
              ← 上一条
            </button>
            <button onClick={() => setCurrent(c => Math.min(queue.length - 1, c + 1))} disabled={current === queue.length - 1}
              className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] disabled:opacity-40 text-xs sm:text-sm transition-colors"
            >
              下一条 →
            </button>
          </div>
        )}
      </main>
    </div>
  )
}