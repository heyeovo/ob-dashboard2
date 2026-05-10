'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'

// ==================== 类型定义 ====================
interface Bucket {
  id: string
  name: string
  type: string
  domain: string[]
  tags: string[]
  valence: number
  arousal: number
  importance: number
  resolved: boolean
  pinned: boolean
  digested?: boolean
  created: string
  last_active: string
  score: number
  activation_count?: number
  content_preview: string
}

interface BucketDetail {
  id: string
  content: string
  score: number
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
  }
}

type QuickFilter = 'all' | 'pinned' | 'important' | 'feel' | 'digested' | 'resolved'
type DatePreset = 'all' | '7d' | '30d' | '90d' | 'custom'
type Status = '已精修' | '存疑' | null

interface ReviewBucket extends Bucket {
  content?: { raw?: string } | string
}

// ==================== 工具函数 ====================
const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '★ 钉选' },
  { key: 'important', label: '重要' },
  { key: 'feel', label: 'feel' },
  { key: 'digested', label: '已消化' },
  { key: 'resolved', label: '已归档' },
]

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: '全部时间' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 3 个月' },
  { key: 'custom', label: '自定义' },
]

const isFeel = (b: Bucket) =>
  b.type === 'feel' || (b.domain ?? []).includes('feel') || (b.tags ?? []).includes('feel')

function matchesQuickFilter(b: Bucket, f: QuickFilter): boolean {
  switch (f) {
    case 'all': return true
    case 'pinned': return b.pinned
    case 'important': return Number(b.importance) >= 7 && !b.pinned
    case 'feel': return isFeel(b)
    case 'digested': return !!b.digested
    case 'resolved': return b.resolved
  }
}

function matchesDateFilter(b: Bucket, preset: DatePreset, start: string, end: string): boolean {
  if (preset === 'all') return true
  const t = new Date(b.created).getTime()
  const now = Date.now()
  if (preset === '7d') return t > now - 7 * 86400000
  if (preset === '30d') return t > now - 30 * 86400000
  if (preset === '90d') return t > now - 90 * 86400000
  if (preset === 'custom') {
    const s = start ? new Date(start).getTime() : 0
    const e = end ? new Date(end).getTime() + 86400000 : Infinity
    return t >= s && t <= e
  }
  return true
}

function formatReviewDate(dateStr: string) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const day = d.getDate()
  const mon = d.toLocaleDateString('en', { month: 'short' })
  const year = d.getFullYear()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${day} ${mon} ${year} · 周${weekdays[d.getDay()]}`
}

function formatDateGroup(dateStr: string) {
  if (dateStr === 'unknown') return '未知时间'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return '未知时间'
  return formatReviewDate(dateStr)
}

function getTopTags(buckets: Bucket[], n = 10): string[] {
  const freq = new Map<string, number>()
  for (const b of buckets)
    for (const t of b.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1)
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
}

function groupByDate(buckets: Bucket[]) {
  const map = new Map<string, Bucket[]>()
  for (const b of buckets) {
    const created = b.created ?? ''
    const d = created ? created.slice(0, 10) : 'unknown'
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(b)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return (b.score ?? 0) - (a.score ?? 0)
      })
    }))
}

// ==================== 审阅子组件 ====================
function ReviewSection({
  buckets,
  categoryMap,
  setCategoryMap,
  categories,
  setCategories,
  onRefresh,
}: {
  buckets: Bucket[]
  categoryMap: Record<string, string>
  setCategoryMap: (v: Record<string, string>) => void
  categories: string[]
  setCategories: React.Dispatch<React.SetStateAction<string[]>>
  onRefresh: () => void
}) {
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})
  const [statesBucketId, setStatesBucketId] = useState('')
  const [filter, setFilter] = useState<'待办' | '存疑' | '已精修' | '全部'>('待办')
  const [timeFilter, setTimeFilter] = useState<'今天' | '全部'>('全部')
  const [current, setCurrent] = useState(0)
  const [fullBucket, setFullBucket] = useState<ReviewBucket | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingStatus, setSavingStatus] = useState(false)
  const [newCatInput, setNewCatInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    fetch('/api/review-status').then(r => r.json()).then(data => {
      setStatusMap(data.statusMap ?? {})
      setStatesBucketId(data.bucketId ?? '')
      setLoading(false)
    })
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
    setSavingStatus(true)
    const newMap = { ...statusMap }
    if (status === null) delete newMap[targetId]
    else newMap[targetId] = status
    setStatusMap(newMap)

    await fetch('/api/review-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statesBucketId, targetId, status }),
    })
    setSavingStatus(false)
    if (filter !== '全部') setCurrent(c => Math.max(0, Math.min(c, queue.length - 2)))
  }, [statusMap, statesBucketId, filter, queue.length])

  const updateCategory = useCallback(async (targetId: string, category: string | null, isNew = false) => {
    const newMap = { ...categoryMap }
    if (category === null) delete newMap[targetId]
    else newMap[targetId] = category
    setCategoryMap(newMap)

    const body: Record<string, unknown> = { statesBucketId, targetId, category }
  if (isNew && category) {
  const cat: string = category
  body.newCategory = cat
  setCategories(prev => prev.includes(cat) ? prev : [...prev, cat])
}
    await fetch('/api/review-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }, [categoryMap, statesBucketId, setCategoryMap, setCategories])

  const getContent = (b: ReviewBucket | null) => {
    if (!b) return ''
    if (typeof b.content === 'string') return b.content
    return b.content?.raw ?? ''
  }

  const startEdit = () => {
    if (!cur) return
    setEditContent(getContent(fullBucket))
    setEditing(true)
  }
  const cancelEdit = () => { setEditing(false); setEditContent('') }
  const saveEdit = async () => {
    if (!cur) return
    setSavingEdit(true)
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cur.id, content: editContent }),
    })
    const updated = await fetch(`/api/bucket/${cur.id}`).then(r => r.json())
    setFullBucket(updated)
    setSavingEdit(false)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!cur) return
    if (!confirm('确定抹除此记忆？不可恢复。')) return
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cur.id, delete: true }),
    })
    onRefresh()
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-[#8A8681] text-sm">加载中…</div>
  )

  const cur = queue[current]

  return (
    <div>
      {/* 顶端：今天/全部 右对齐 */}
      <div className="flex justify-end mb-4">
        <div className="flex gap-1.5">
          {(['今天', '全部'] as const).map(t => (
            <button key={t} onClick={() => { setTimeFilter(t); setCurrent(0) }}
              className={`text-xs px-3 py-1 rounded-full border transition-colors whitespace-nowrap ${
                timeFilter === t
                  ? 'bg-[#D97757] border-[#D97757] text-white'
                  : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 状态过滤行：更精致圆润的胶囊 */}
      <div className="flex justify-center gap-2 mb-6 flex-wrap">
        {(['待办', '存疑', '已精修', '全部'] as const).map(f => (
          <button key={f} onClick={() => { setFilter(f); setCurrent(0) }}
            className={`flex items-center gap-1 text-xs px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap ${
              filter === f
                ? 'bg-[#2B2927] border-[#2B2927] text-white'
                : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
            }`}
          >
            <span className={`text-[10px] ${
              f === '待办' ? 'text-yellow-400' :
              f === '存疑' ? 'text-red-400' :
              f === '已精修' ? 'text-green-400' : 'text-[#A8A49D]'
            }`}>●</span>
            {f} {f !== '全部' && <span className="opacity-60 ml-0.5">{counts[f as keyof typeof counts]}</span>}
          </button>
        ))}
      </div>

      {/* 卡片 */}
      {!cur ? (
        <div className="text-center text-[#A8A49D] py-20 text-sm bg-white rounded-2xl border border-[#E8E6E1] border-dashed">
          {filter === '待办' ? '🎉 全部审阅完啦' : '这里什么都没有'}
        </div>
      ) : (
        <div className="bg-white border border-[#E8E6E1] rounded-2xl p-4 sm:p-6 shadow-sm mb-5">
          {/* 第一行：日期 左，页码右 */}
          <div className="flex items-center justify-between text-xs text-[#A8A49D] mb-3">
            <span>{formatReviewDate(cur.created || '')}</span>
            <span>{current + 1}/{queue.length}</span>
          </div>

          {/* 第二行：标题加 imp|score */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg sm:text-xl font-semibold text-[#2B2927]">{cur.name}</h2>
            <div className="text-xs text-[#A8A49D] flex items-center gap-2 flex-shrink-0 ml-4">
              <span>imp {cur.importance ?? '—'}</span>
              <span>|</span>
              <span className="text-[#D97757] font-medium">score {cur.score?.toFixed(2) ?? '—'}</span>
            </div>
          </div>

          {/* 状态标签 */}
          {statusMap[cur.id] && (
            <div className="mb-3">
              <span className={`text-xs px-2.5 py-0.5 rounded-full ${
                statusMap[cur.id] === '已精修' ? 'bg-[#EAF5E9] text-[#478B4A]' : 'bg-[#FDF3E4] text-[#C97E2C]'
              }`}>
                {statusMap[cur.id]}
              </span>
            </div>
          )}

          {/* 标签（透明高级感） */}
          {cur.tags && cur.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {cur.tags.map(t => (
                <span key={t} className="text-xs px-2.5 py-0.5 rounded-full bg-white/60 backdrop-blur-sm border border-[#E8E6E1] text-[#6C6965]">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* 正文 */}
          {editing ? (
            <textarea
              className="w-full bg-[#FDFCFB] border border-[#D97757] rounded-xl p-4 text-sm leading-relaxed resize-none mb-4"
              rows={8}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
            />
          ) : (
            <div className="text-[#3A3836] text-sm leading-relaxed whitespace-pre-wrap bg-[#FDFCFB] rounded-xl p-4 border border-[#F0EFEB] max-h-72 overflow-y-auto mb-4">
              {fullBucket ? getContent(fullBucket) : '加载中…'}
            </div>
          )}

          {/* 分类选择 */}
          <div className="flex gap-2 items-center">
            <select
              value={categoryMap[cur.id] ?? ''}
              onChange={e => updateCategory(cur.id, e.target.value || null)}
              className="flex-1 bg-white text-[#3A3836] text-xs sm:text-sm rounded-lg px-2.5 py-2 border border-[#E8E6E1] outline-none focus:border-[#D97757]"
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
              className="w-24 sm:w-32 bg-white text-[#3A3836] text-xs sm:text-sm rounded-lg px-2.5 py-2 border border-[#E8E6E1] outline-none focus:border-[#D97757]"
            />
          </div>
        </div>
      )}

      {/* 操作按钮组 */}
      {cur && (
        <div className="grid grid-cols-4 gap-2 mb-6">
          <button onClick={() => updateStatus(cur.id, '已精修')} disabled={savingStatus}
            className="py-2.5 rounded-xl bg-[#EAF5E9] border border-[#C5E0C3] text-[#478B4A] hover:bg-[#D4EAD2] text-xs sm:text-sm font-semibold disabled:opacity-50"
          >✓ 已阅</button>
          <button onClick={() => updateStatus(cur.id, '存疑')} disabled={savingStatus}
            className="py-2.5 rounded-xl bg-[#FDF3E4] border border-[#F2D9B6] text-[#C97E2C] hover:bg-[#FBE9D0] text-xs sm:text-sm font-semibold disabled:opacity-50"
          >? 存疑</button>
          <button onClick={handleDelete} disabled={savingStatus}
            className="py-2.5 rounded-xl bg-[#FCE8E7] border border-[#F0C0BF] text-[#C64B45] hover:bg-[#FADAD9] text-xs sm:text-sm font-semibold disabled:opacity-50"
          >🗑 删除</button>
          {editing ? (
            <>
              <button onClick={cancelEdit}
                className="py-2.5 rounded-xl bg-[#F4F2EC] border border-[#E8E6E1] text-[#6C6965] hover:bg-[#E8E4DC] text-xs sm:text-sm font-semibold"
              >取消</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="py-2.5 rounded-xl bg-[#D97757] text-white hover:bg-[#C86645] text-xs sm:text-sm font-semibold disabled:opacity-50"
              >保存</button>
            </>
          ) : (
            <button onClick={startEdit}
              className="py-2.5 rounded-xl bg-[#EDF4FC] border border-[#C8DAF0] text-[#3B72B9] hover:bg-[#E0ECF8] text-xs sm:text-sm font-semibold"
            >✎ 编辑</button>
          )}
        </div>
      )}

      {/* 翻页 */}
      {queue.length > 1 && (
        <div className="flex justify-between">
          <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
            className="px-5 py-2 rounded-lg bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] disabled:opacity-40 text-sm"
          >← 上一条</button>
          <button onClick={() => setCurrent(c => Math.min(queue.length - 1, c + 1))} disabled={current === queue.length - 1}
            className="px-5 py-2 rounded-lg bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] disabled:opacity-40 text-sm"
          >下一条 →</button>
        </div>
      )}
    </div>
  )
}

// ==================== 主页组件 ====================
export default function Home() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'grid' | 'review'>('timeline')
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Bucket[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', content: '', tags: '', importance: 5 })
  const [adding, setAdding] = useState(false)
  const [gridViewMode, setGridViewMode] = useState<'list' | 'card'>('list')
  const [sortBy, setSortBy] = useState<'score' | 'importance' | 'created'>('score')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [categories, setCategories] = useState<string[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('')

  const fetchBuckets = useCallback(() =>
    fetch('/api/buckets').then(r => r.json()).then(data => setBuckets(data)), [])

  useEffect(() => { fetchBuckets().then(() => setLoading(false)) }, [])

  useEffect(() => {
    fetch('/api/review-status').then(r => r.json()).then(data => {
      setCategoryMap(data.categoryMap ?? {})
      setCategories(data.categories ?? [])
    })
  }, [])

  useEffect(() => {
    setQuickFilter('all')
    setActiveTag(null)
  }, [activeTab])

  const doSearch = async (q: string) => {
    setSearch(q)
    if (!q.trim()) { setSearchResults(null); return }
    setSearchLoading(true)
    setQuickFilter('all')
    setActiveTag(null)
    setDatePreset('all')
    setCustomStart('')
    setCustomEnd('')
    try {
      const raw = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json())
      const arr = Array.isArray(raw) ? raw : []
      const enriched = arr.map((item: any) => {
        const local = buckets.find(b => b.id === item.id)
        return {
          ...item,
          created: item.created || local?.created || new Date().toISOString(),
          pinned: item.pinned ?? local?.pinned ?? false,
          importance: item.importance ?? local?.importance ?? 0,
          resolved: item.resolved ?? local?.resolved ?? false,
          digested: item.digested ?? local?.digested ?? false,
          tags: item.tags ?? local?.tags ?? [],
          domain: item.domain ?? local?.domain ?? [],
          content_preview: item.content_preview ?? local?.content_preview ?? '',
        }
      })
      setSearchResults(enriched)
    } catch (e) {
      console.error(e)
    } finally {
      setSearchLoading(false)
    }
  }

  const openBucket = async (id: string) => {
    setDetailLoading(true)
    setSelected(null)
    setEditing(false)
    const data = await fetch(`/api/bucket/${id}`).then(r => r.json())
    setSelected(data)
    setDetailLoading(false)
  }

  const traceOp = async (id: string, args: Record<string, unknown>) => {
    setOperating(true)
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...args })
    })
    const [, detail] = await Promise.all([
      fetchBuckets(),
      fetch(`/api/bucket/${id}`).then(r => r.json())
    ])
    setSelected(detail)

    setOperating(false)
  }

  const saveEdit = async () => {
    if (!selected) return
    setSaving(true)
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, content: editContent })
    })
    setSaving(false)
    setEditing(false)
    openBucket(selected.id)
  }

  const copyId = () => {
    if (!selected) return
    navigator.clipboard.writeText(selected.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const topTags = useMemo(() => getTopTags(buckets), [buckets])
  const baseList = searchResults ?? buckets
  const displayed = baseList.filter(b =>
    matchesQuickFilter(b, quickFilter) &&
    matchesDateFilter(b, datePreset, customStart, customEnd) &&
    (!activeTag || (activeTag === 'feel' ? isFeel(b) : (b.tags ?? []).includes(activeTag))) &&
    (activeCategory === '' || categoryMap[b.id] === activeCategory)
  )

  const grouped = useMemo(() => groupByDate(displayed), [displayed])

  const toggleDateCollapse = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  const BucketCard = ({ b }: { b: Bucket }) => (
    <div onClick={() => openBucket(b.id)}
      className="bg-white rounded-xl p-4 sm:p-5 hover:shadow-md cursor-pointer border border-[#E8E6E1] hover:border-[#D97757]/30 transition-all duration-200 group w-full">
      <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2 sm:gap-3">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
          {b.pinned && <span className="text-[#D97757] text-xs sm:text-sm flex-shrink-0">★</span>}
          <span className="font-semibold text-[#3A3836] text-sm sm:text-base truncate group-hover:text-[#D97757] transition-colors">
            {b.name}
          </span>
          {isFeel(b) && <span className="text-xs bg-[#FDF0ED] text-[#D97757] px-1.5 py-0.5 rounded-full font-medium">feel</span>}
          {b.resolved && <span className="text-xs bg-[#F4F2EC] text-[#8A8681] px-1.5 py-0.5 rounded-full">已归档</span>}
          {b.digested && <span className="text-xs bg-[#EAF5E9] text-[#478B4A] px-1.5 py-0.5 rounded-full">已消化</span>}
        </div>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 text-xs sm:text-sm">
          <span className="text-[#A8A49D] font-medium">imp {Number(b.importance) > 0 ? Number(b.importance) : '—'}</span>
          <span className="text-[#A8A49D]">|</span>
          <span className="text-[#D97757] font-medium">score {b.score != null ? b.score.toFixed(1) : '—'}</span>
        </div>
      </div>
      <p className="text-xs sm:text-sm text-[#6C6965] line-clamp-2 mb-3 sm:mb-4 leading-relaxed">{b.content_preview}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1 sm:gap-1.5">
          {(b.domain ?? []).map(d => (
            <span key={d} className="text-xs bg-[#F4F2EC] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[#5B5854]">{d}</span>
          ))}
          {(b.tags ?? []).slice(0, 3).map(t => (
            <span key={t} className="text-xs border border-[#E8E6E1] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[#8A8681]">{t}</span>
          ))}
          {(b.tags ?? []).length > 3 && (
            <span className="text-xs text-[#A8A49D] py-0.5 px-1">+{(b.tags ?? []).length - 3}</span>
          )}
        </div>
        {b.last_active && (
          <span className="text-xs text-[#A8A49D] flex-shrink-0">
            {new Date(b.last_active).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  )

  const GridSection = ({ title, items }: { title: string, items: Bucket[] }) => {
    if (items.length === 0) return null;
    let sortedItems = [...items];
    sortedItems.sort((a, b) => {
      let result = 0;
      if (sortBy === 'score') {
        result = (b.score ?? 0) - (a.score ?? 0);
      } else if (sortBy === 'importance') {
        result = (b.importance ?? 0) - (a.importance ?? 0);
      } else if (sortBy === 'created') {
        result = new Date(b.created).getTime() - new Date(a.created).getTime();
      }
      return sortOrder === 'desc' ? result : -result;
    });
    return (
      <div className="mb-8 sm:mb-10">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-5">
          <span className="text-sm sm:text-base font-semibold text-[#3A3836] italic">{title}</span>
          <span className="text-xs text-[#A8A49D] bg-[#F4F2EC] px-2 py-0.5 rounded-md">{sortedItems.length} 条</span>
          <div className="flex-1 h-px bg-[#E8E6E1]"></div>
        </div>
        {gridViewMode === 'list' ? (
          <div className="space-y-2 sm:space-y-3">
            {sortedItems.map(b => <BucketCard key={b.id} b={b} />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
            {sortedItems.map(b => <BucketCard key={b.id} b={b} />)}
          </div>
        )}
      </div>
    )
  }

  const statusCounts = useMemo(() => {
    const list = searchResults ?? buckets
    return {
      all: list.length,
      pinned: list.filter(b => b.pinned).length,
      important: list.filter(b => Number(b.importance) >= 7 && !b.pinned).length,
      feel: list.filter(b => isFeel(b)).length,
      digested: list.filter(b => !!b.digested).length,
      resolved: list.filter(b => b.resolved).length,
    }
  }, [searchResults, buckets])

  if (loading) return <div className="flex items-center justify-center h-screen bg-[#FCFAF8] text-[#8A8681]">读取中...</div>

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans selection:bg-[#D97757] selection:text-white pb-20">
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* 顶部导航 */}
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[#8A8681]">
          <span className="text-[#3A3836] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-[#D97757] to-[#E8A58F]"></div>
            <span className="text-xs sm:text-sm">Ombre Brain</span>
          </span>
          {(['timeline', 'grid', 'review'] as const).map(tab => (
            <span key={tab} onClick={() => setActiveTab(tab)}
              className={`cursor-pointer transition-colors h-full flex items-center whitespace-nowrap ${
                activeTab === tab ? 'text-[#3A3836] border-b-2 border-[#D97757]' : 'hover:text-[#3A3836]'
              }`}>
              {tab === 'timeline' ? '时间线' : tab === 'grid' ? '记忆格' : '审阅'}
            </span>
          ))}
          <span className="hover:text-[#3A3836] cursor-pointer transition-colors ml-auto whitespace-nowrap">配置</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        {activeTab !== 'review' && (
          <div className="hidden md:block mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[#2B2927] mb-2 sm:mb-3">
              {activeTab === 'timeline' ? '时间线' : '记忆格'}
            </h1>
            <p className="text-[#8A8681] text-xs sm:text-sm">
              {activeTab === 'timeline' 
                ? `沿时间回溯，当前展示 ${displayed.length} 条记录` 
                : `分类整理与检索 · ${buckets.length} 格`}
            </p>
          </div>
        )}

        {activeTab === 'review' ? (
          <ReviewSection 
            buckets={buckets}
            categoryMap={categoryMap}
            setCategoryMap={setCategoryMap}
            categories={categories}
            setCategories={setCategories}
            onRefresh={fetchBuckets}
          />
        ) : (
          <>
            <div className="bg-white border border-[#E8E6E1] rounded-2xl p-3 sm:p-4 shadow-sm mb-4">
              <div className="relative w-full mb-3 sm:mb-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8A49D]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="8.5" cy="8.5" r="6" /><path d="M13.5 13.5L18 18" />
                </svg>
                <input
                  className="w-full bg-[#F9F8F6] border border-transparent rounded-xl pl-8 pr-4 py-2.5 text-sm outline-none focus:bg-white focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]/10 transition-all placeholder-[#A8A49D]"
                  placeholder="搜索记忆、标签或内容..."
                  value={search}
                  onChange={e => doSearch(e.target.value)}
                />
              </div>
              <div className="w-full h-px bg-[#F0EFEB] mb-3 sm:mb-4"></div>

              <div className="flex flex-wrap items-center gap-y-3 gap-x-4">
                <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
                  {QUICK_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setQuickFilter(f.key)}
                      className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full transition-all border whitespace-nowrap ${
                        quickFilter === f.key 
                          ? 'bg-[#3A3836] border-[#3A3836] text-white' 
                          : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:border-[#C4C1BC] hover:bg-[#F9F8F6]'
                      }`}>
                      {f.label} {statusCounts[f.key]}
                    </button>
                  ))}
                </div>
                {categories.length > 0 && (
                  <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
                    <button onClick={() => setActiveCategory('')}
                      className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full border whitespace-nowrap ${
                        activeCategory === '' ? 'bg-[#3A3836] text-white' : 'bg-white text-[#6C6965] hover:bg-[#F9F8F6]'
                      }`}>
                      全部
                    </button>
                    {categories.map(c => (
                      <button key={c} onClick={() => setActiveCategory(c)}
                        className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full border whitespace-nowrap ${
                          activeCategory === c ? 'bg-[#3A3836] text-white' : 'bg-white text-[#6C6965] hover:bg-[#F9F8F6]'
                        }`}>{c}</button>
                    ))}
                  </div>
                )}
              </div>

              {activeTab === 'grid' && (
                <div className="flex gap-1.5 sm:gap-2 mt-4 pt-4 border-t border-[#F0EFEB] overflow-x-auto no-scrollbar">
                  <button onClick={() => setActiveTag(activeTag === 'feel' ? null : 'feel')}
                    className={`text-xs px-2.5 sm:px-3 py-1 rounded-md whitespace-nowrap ${
                      activeTag === 'feel' ? 'bg-[#D97757] text-white' : 'text-[#8A8681] hover:bg-[#F4F2EC]'
                    }`}>
                    feel
                  </button>
                  {topTags.map(t => (
                    <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)}
                      className={`text-xs px-2.5 sm:px-3 py-1 rounded-md whitespace-nowrap ${
                        activeTag === t ? 'bg-[#D97757] text-white' : 'text-[#8A8681] hover:bg-[#F4F2EC]'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 工具条 */}
            <div className="flex items-center justify-end gap-2 sm:gap-3 mb-6 px-1">
              <div className="flex items-center gap-2 bg-white/40 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-[#E8E6E1] shadow-sm">
                <span className="text-xs text-[#A8A49D] hidden sm:inline">时间</span>
                <select
                  className="text-xs bg-transparent outline-none text-[#5B5854] cursor-pointer"
                  value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}>
                  {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                {datePreset === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                      className="bg-white rounded px-1.5 py-0.5 text-xs border border-[#E8E6E1]" />
                    <span className="text-[#A8A49D]">-</span>
                    <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                      className="bg-white rounded px-1.5 py-0.5 text-xs border border-[#E8E6E1]" />
                  </div>
                )}
              </div>
              {activeTab === 'grid' && (
                <>
                  <button onClick={() => setGridViewMode(gridViewMode === 'list' ? 'card' : 'list')}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[#E8E6E1] bg-white/60 backdrop-blur-sm text-[#6C6965] hover:bg-[#F9F8F6]"
                  >{gridViewMode === 'list' ? '⧉' : '☰'}</button>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[#E8E6E1] bg-white/60 backdrop-blur-sm text-[#6C6965] outline-none cursor-pointer">
                    <option value="score">权重</option>
                    <option value="importance">重要度</option>
                    <option value="created">时间</option>
                  </select>
                  <button onClick={() => setSortOrder(order => order === 'desc' ? 'asc' : 'desc')}
                    className={`text-xs px-2.5 py-1.5 rounded-md border ${sortOrder === 'desc' ? 'bg-[#D97757] text-white' : 'bg-white/60 backdrop-blur-sm text-[#6C6965] hover:bg-[#F9F8F6]'}`}
                  >{sortOrder === 'desc' ? '↓降序' : '↑升序'}</button>
                </>
              )}
            </div>

            {/* 时间线 - 带折叠箭头的日期组 */}
            {activeTab === 'timeline' ? (
              <div className="space-y-6 sm:space-y-8">
                {grouped.map(({ date, items }) => {
  const isCollapsed = collapsedDates.has(date)
  return (
    <div key={date} className="relative pl-4">
      {/* 箭头替代圆点，始终显示 */}
      <button
        onClick={() => toggleDateCollapse(date)}
        className="absolute -left-[7px] top-2 -translate-y-1/2 text-[#D97757] hover:text-[#B65D40] transition-colors z-10"
      >
       <span className={`leading-none ${isCollapsed ? 'text-xs' : 'text-sm'}`}>
  {isCollapsed ? '▶' : '▼'}
</span>
      </button>

      <button
        onClick={() => toggleDateCollapse(date)}
        className="flex items-center gap-3 mb-4 ml-1 cursor-pointer hover:text-[#D97757] transition-colors text-left w-full"
      >
        <span className="text-sm font-semibold text-[#3A3836]">{formatDateGroup(date)}</span>
        <span className="text-xs text-[#A8A49D] bg-[#F4F2EC] px-2 py-0.5 rounded-md">{items.length} 条</span>
      </button>

      {!isCollapsed && (
        <>
          {/* 竖线只在展开时出现 */}
          <div className="absolute left-0 top-2.5 bottom-0 w-px bg-[#E8E6E1]"></div>
          <div className="space-y-3 ml-1">
            {items.map(b => <BucketCard key={b.id} b={b} />)}
          </div>
        </>
      )}
    </div>
  )
})}
              </div>
            ) : (
              <div>
                {quickFilter === 'all' ? (
                  <>
                    <GridSection title="★ 钉选记忆" items={displayed.filter(b => b.pinned)} />
                    <GridSection title="♦ 重要 (imp ≥ 7)" items={displayed.filter(b => !b.pinned && Number(b.importance) >= 7 && !b.resolved && !b.digested)} />
                    <GridSection title="已归档" items={displayed.filter(b => !b.pinned && b.resolved)} />
                    <GridSection title="已消化" items={displayed.filter(b => !b.pinned && !b.resolved && b.digested)} />
                    <GridSection title="其他记忆" items={displayed.filter(b => !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested)} />
                  </>
                ) : (
                  <GridSection title={QUICK_FILTERS.find(f => f.key === quickFilter)?.label || ''} items={displayed} />
                )}
              </div>
            )}
            {displayed.length === 0 && (
              <div className="text-center text-[#A8A49D] py-20 text-sm bg-white rounded-2xl border border-dashed border-[#E8E6E1]">
                没有找到对应的记录
              </div>
            )}
          </>
        )}
      </main>

      {/* 详情抽屉 */}
      <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${selected || detailLoading ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-[#3A3836]/20 backdrop-blur-sm" onClick={() => { setSelected(null); setEditing(false) }} />
        <div className={`absolute right-0 top-0 h-full w-full sm:max-w-2xl bg-white shadow-2xl transition-transform duration-300 transform ${selected || detailLoading ? 'translate-x-0' : 'translate-x-full'}`}
          onClick={e => e.stopPropagation()}>
          {detailLoading ? (
  <div className="flex items-center justify-center h-full text-[#A8A49D]">读取中...</div>
) : selected ? (
  <div className="p-6 sm:p-8 overflow-y-auto h-full">
    <div className="flex items-start justify-between mb-6 pb-4 border-b border-[#F0EFEB]">
      <div className="pr-4">
        <div className="flex items-center gap-2 mb-1">
          {selected.metadata.pinned && <span className="text-[#D97757] text-lg">★</span>}
          <h2 className="text-xl sm:text-2xl font-bold text-[#2B2927]">{selected.metadata.name}</h2>
        </div>
       <div className="text-xs text-[#8A8681] truncate mt-2">
  创建: {selected.metadata.created}{' '}·{' '}
  修改: {selected.metadata.last_active}
</div>
      </div>
      <button onClick={() => { setSelected(null); setEditing(false) }}
        className="text-[#A8A49D] hover:text-[#3A3836] p-1.5 bg-[#F9F8F6] rounded-full">✕</button>
    </div>

    {/* 信息胶囊行：四个等宽小方块 */}
    <div className="grid grid-cols-4 gap-2 mb-4">
      <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
        <div className="text-[10px] text-[#8A8681] mb-0.5">重要度</div>
        <div className="text-sm font-semibold text-[#3A3836]">{selected.metadata.importance}/10</div>
      </div>
      <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
        <div className="text-[10px] text-[#8A8681] mb-0.5">权重</div>
        <div className="text-sm font-semibold text-[#3A3836]">{selected.score?.toFixed(2) ?? '—'}</div>
      </div>
      <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
        <div className="text-[10px] text-[#8A8681] mb-0.5">激活</div>
        <div className="text-sm font-semibold text-[#3A3836]">{selected.metadata.activation_count ?? '—'}</div>
      </div>
      <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
        <div className="text-[10px] text-[#8A8681] mb-0.5">状态</div>
        <div className="text-sm font-semibold text-[#3A3836]">{selected.metadata.resolved ? '已归档' : '活跃中'}</div>
      </div>
    </div>

    {/* 标签 */}
    <div className="flex flex-wrap gap-1.5 mb-4">
      {(selected.metadata.domain ?? []).map(d => (
        <span key={d} className="text-xs bg-[#EFECE6] px-2.5 py-1 rounded-md text-[#5B5854]">{d}</span>
      ))}
      {(selected.metadata.tags ?? []).map(t => (
        <span key={t} className="text-xs border border-[#E8E6E1] px-2.5 py-1 rounded-md text-[#6C6965]">{t}</span>
      ))}
    </div>

    {/* 操作按钮组：四个等宽按钮，位于标签下方 */}
    <div className="grid grid-cols-4 gap-2 mb-6">
      <button disabled={operating}
        onClick={() => traceOp(selected.id, { pinned: selected.metadata.pinned ? 0 : 1 })}
        className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
          selected.metadata.pinned
            ? 'bg-[#FDF0ED] text-[#D97757]'
            : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
        }`}>
        {selected.metadata.pinned ? '已钉选' : '钉 选'}
      </button>
      <button disabled={operating}
        onClick={() => traceOp(selected.id, { resolved: selected.metadata.resolved ? 0 : 1 })}
        className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
          selected.metadata.resolved
            ? 'bg-[#EAF5E9] text-[#478B4A]'
            : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
        }`}>
        {selected.metadata.resolved ? '已归档' : '归 档'}
      </button>
      <button disabled={operating}
        onClick={() => traceOp(selected.id, { digested: selected.metadata.digested ? 0 : 1 })}
        className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
          selected.metadata.digested
            ? 'bg-[#EAF5E9] text-[#478B4A]'
            : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
        }`}>
        {selected.metadata.digested ? '已消化' : '消 化'}
      </button>
    <div className="bg-white border border-[#E8E6E1] rounded-lg flex items-center justify-center gap-1 px-2 py-2">
  <span className="text-[10px] text-[#8A8681]">IMP</span>
  <input 
    key={selected?.id + '-' + selected?.metadata?.importance}
    type="number" min="0" max="10"
    className="w-10 text-sm font-bold text-[#D97757] outline-none text-center"
    defaultValue={selected?.metadata?.importance ?? ''}
    disabled={operating}
    onBlur={async (e) => {
      const val = parseInt(e.target.value);
      if (!selected || isNaN(val) || val === selected.metadata.importance) return;
      setOperating(true);
      await fetch('/api/edit-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, importance: val }),
      });
      const updated = await fetch(`/api/bucket/${selected.id}`).then(r => r.json());
      setSelected(updated);
      setOperating(false);
    }}
  />
</div>
    </div>

    {/* 内容区 */}
    {!editing ? (
      <div className="bg-[#FDFCFB] border border-[#F0EFEB] rounded-xl overflow-hidden mb-4">
        <div className="flex justify-between items-center px-5 pt-3 pb-2 border-b border-[#F0EFEB]">
          <span className="text-xs font-medium text-[#A8A49D] uppercase tracking-wider">内容</span>
          <button onClick={() => { setEditing(true); setEditContent(selected.content) }}
            className="text-xs text-[#D97757] font-medium hover:text-[#B65D40]">编辑</button>
        </div>
        <div className="p-5 text-sm leading-loose whitespace-pre-wrap">
          {selected.content}
        </div>
      </div>
    ) : (
      <div className="bg-[#FDFCFB] border border-[#D97757] rounded-xl p-4 mb-4">
        <textarea
          className="w-full bg-transparent text-sm leading-relaxed resize-none outline-none"
          rows={14}
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={() => setEditing(false)} className="text-sm text-[#8A8681] hover:text-[#3A3836]">取消</button>
          <button onClick={saveEdit} disabled={saving}
            className="text-sm bg-[#D97757] text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{saving ? '保存中' : '保存更改'}</button>
        </div>
      </div>
    )}

    {/* 抹除和索引 */}
    <div className="flex justify-between items-center">
      <button onClick={() => { if (confirm('确定抹除此记忆？不可恢复。')) { traceOp(selected.id, { delete: true }).then(() => setSelected(null)) } }}
        className="text-sm text-[#C64B45] font-medium hover:text-red-700">抹除</button>
      <div onClick={copyId} className="inline-flex items-center gap-2 text-xs cursor-pointer hover:bg-[#F0EFEB] px-3 py-1.5 rounded-full">
        <span className="text-[#A8A49D]">索引: {selected.id}</span>
        <span className={`${copied ? 'text-[#D97757]' : 'text-[#A8A49D]'}`}>{copied ? '已复制' : '复制'}</span>
      </div>
    </div>
  </div>
) : null}
        </div>
      </div>

      {/* 悬浮加号 */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#D97757] text-white text-xl sm:text-2xl shadow-lg hover:bg-[#C86645] transition-colors flex items-center justify-center z-50">
        +
      </button>

      {/* 新增弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4"
          onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-4 sm:p-6 w-full max-w-lg shadow-xl"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-[#3A3836] font-semibold mb-4">新增记忆</h3>
            <input placeholder="标题（可选）" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[#D97757]" />
            <textarea placeholder="内容…" value={addForm.content} onChange={e => setAddForm(f => ({ ...f, content: e.target.value }))}
              rows={5} className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm mb-3 resize-none focus:outline-none focus:border-[#D97757]" />
            <input placeholder="标签（逗号分隔）" value={addForm.tags} onChange={e => setAddForm(f => ({ ...f, tags: e.target.value }))}
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-[#D97757]" />
            <div className="flex items-center gap-3 mb-5">
              <span className="text-sm text-[#8A8681]">重要度</span>
              <input type="range" min={1} max={10} value={addForm.importance} onChange={e => setAddForm(f => ({ ...f, importance: Number(e.target.value) }))}
                className="flex-1 accent-[#D97757]" />
              <span className="text-sm text-[#3A3836] w-4">{addForm.importance}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[#8A8681]">取消</button>
              <button disabled={!addForm.content.trim() || adding}
                onClick={async () => {
                  setAdding(true)
                  await fetch('/api/add-bucket', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...addForm, content: addForm.title ? `${addForm.title}\n${addForm.content}` : addForm.content })
                  })
                  setAdding(false)
                  setShowAdd(false)
                  setAddForm({ title: '', content: '', tags: '', importance: 5 })
                  fetchBuckets()
                }}
                className="px-4 py-2 text-sm bg-[#D97757] text-white rounded-lg disabled:opacity-40 hover:bg-[#C86645] transition-colors">
                {adding ? '存入中…' : '存入记忆'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
