'use client'

export const dynamic = 'force-dynamic'
import { Suspense, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import BucketDetailDrawer from './components/BucketDetailDrawer'
import NavBar from './components/NavBar'
import StatusBadge, { statusLabel } from './components/StatusBadge'
import DetailPanel from './components/DetailPanel'
import Card from './components/Card'
import MobileViewSwitch from './components/MobileViewSwitch'
import SearchBar from './components/SearchBar'
import FilterBar, { FilterPill } from './components/FilterBar'
import { formatBeijingDate, getBeijingDayOfWeek } from '@/app/utils/format'

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
  wish?: boolean
  todo?: string
  todo_done?: boolean
  related?: string[]
  noise?: boolean  // resolved + importance==1
}

interface BucketDetail {
  id: string
  content: string
  score: number
  noise?: boolean
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
    wish?: boolean
    todo?: string
    todo_done?: boolean
    related?: string[]
  }
}

type QuickFilter = 'all' | 'pinned' | 'important' | 'feel' | 'digested' | 'resolved' | 'archived' | 'noise' | 'other'
type DatePreset = 'all' | '7d' | '30d' | '90d' | 'custom'
type Status = '已精修' | '存疑' | null

interface ReviewBucket extends Bucket {
  content?: string
}

// ==================== 工具函数 ====================
const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '★ 钉选' },
  { key: 'important', label: '重要' },
  { key: 'feel', label: 'feel' },
  { key: 'digested', label: '已消化' },
  { key: 'resolved', label: '已解决' },
  { key: 'archived', label: '已归档' },
  { key: 'noise', label: '🔇 噪声' },
  { key: 'other', label: '其他记忆' },
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
    case 'archived': return b.type === 'archived'
    case 'noise': return !!b.noise || (b.resolved && b.importance === 1)
    case 'other': return !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested && !isFeel(b)
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
  const datePart = formatBeijingDate(dateStr) // e.g. "2026/06/08"
  const dayOfWeek = getBeijingDayOfWeek(dateStr) // e.g. "周一"
  const parts = datePart.split('/')
  const day = parseInt(parts[2], 10)
  const monthNum = parseInt(parts[1], 10) - 1 // 0-indexed
  const year = parts[0]
  const monthShort = new Date(Date.UTC(2000, monthNum)).toLocaleDateString('en', { month: 'short' })
  return `${day} ${monthShort} ${year} · ${dayOfWeek}`
}

function formatDateGroup(dateStr: string) {
  if (dateStr === 'unknown') return '未知时间'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return '未知时间'
  return formatReviewDate(dateStr)
}

function getTopTags(buckets: Bucket[], n = 10): string[] {
  if (!Array.isArray(buckets)) return [];
  const freq = new Map<string, number>();
  for (const b of buckets)
    for (const t of b.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
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
        return new Date(b.created).getTime() - new Date(a.created).getTime()
      })
    }))
}

// 在 groupByDate 下方新增一个函数
function groupByMonth(buckets: Bucket[]) {
  const map = new Map<string, Bucket[]>()
  for (const b of buckets) {
    const d = (b.created ?? '').slice(0, 7) || 'unknown'  // 取 YYYY-MM
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(b)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))   // 月份倒序
    .map(([month, items]) => {
      // 对每个月内的 buckets 再按天分组（复用原逻辑）
      const days = groupByDate(items)   // 返回 { date, items }[]
      return { month, days }
    })
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
  const raw = localStorage.getItem('review_state')
  if (raw) {
    try {
      const data = JSON.parse(raw)
      setStatusMap(data.statusMap ?? {})
      setCategoryMap(data.categoryMap ?? {})
      setCategories(data.categories ?? [])
    } catch {}
  }
  setLoading(false)
}, [])

const saveLocal = useCallback((sm: Record<string, string>, cm: Record<string, string>, cats: string[]) => {
  localStorage.setItem('review_state', JSON.stringify({
    statusMap: sm,
    categoryMap: cm,
    categories: cats,
  }));
}, []);

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
    saveLocal(newMap, categoryMap, categories)   // ← 新加这一行

    setSavingStatus(false)
    if (filter !== '全部') setCurrent(c => Math.max(0, Math.min(c, queue.length - 2)))
}, [statusMap, categoryMap, categories, saveLocal, filter, queue.length])

 const updateCategory = useCallback(async (targetId: string, category: string | null, isNew = false) => {
    const newMap = { ...categoryMap }
    if (category === null) delete newMap[targetId]
    else newMap[targetId] = category
    setCategoryMap(newMap)

    let newCategories = [...categories]
    if (isNew && category && !newCategories.includes(category)) {
      newCategories.push(category)
      setCategories(newCategories)
    }
    
    saveLocal(statusMap, newMap, newCategories)   // ← 新加
    
    // 原来的 fetch 全部删除，不需要了
}, [categoryMap, categories, statusMap, saveLocal, setCategoryMap, setCategories])

  const getContent = (b: ReviewBucket | null) => {
    if (!b) return ''
    return b.content ?? ''
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
    <div className="flex items-center justify-center py-20 text-[var(--color-text-tertiary)] text-sm">加载中…</div>
  )

  const cur = queue[current]

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Fixed top filters */}
      <div className="flex-shrink-0">
        {/* 状态过滤行 + 今天/全部 */}
        <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
          {(['待办', '存疑', '已精修', '全部'] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); setCurrent(0) }}
              className={`flex items-center gap-1 text-xs px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                filter === f
                  ? 'bg-[var(--color-text-heading)] border-[var(--color-text-heading)] text-white'
                  : 'bg-white border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
              }`}
            >
              <span className={`text-[10px] ${
                f === '待办' ? 'text-yellow-400' :
                f === '存疑' ? 'text-red-400' :
                f === '已精修' ? 'text-green-400' : 'text-[var(--color-text-disabled)]'
              }`}>●</span>
              {f} {f !== '全部' && <span className="opacity-60 ml-0.5">{counts[f as keyof typeof counts]}</span>}
            </button>
          ))}
          {/* 今天/全部 — 跟在筛选行末尾 */}
          <div className="flex gap-1.5 ml-2 pl-2 border-l border-[var(--color-border)]">
            {(['今天', '全部'] as const).map(t => (
              <button key={t} onClick={() => { setTimeFilter(t); setCurrent(0) }}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
                  timeFilter === t
                    ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                    : 'bg-white border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable middle */}
      <div className="flex-1 overflow-y-auto min-h-0 mb-4">
        {/* 卡片 */}
        {!cur ? (
          <div className="text-center text-[var(--color-text-disabled)] py-20 text-sm bg-white rounded-2xl border border-[var(--color-border)] border-dashed">
            {filter === '待办' ? '🎉 全部审阅完啦' : '这里什么都没有'}
          </div>
        ) : (
          <div className="bg-white border border-[var(--color-border)] rounded-2xl p-4 sm:p-6 shadow-sm mb-4">
          {/* 第一行：日期 左，页码右 */}
          <div className="flex items-center justify-between text-xs text-[var(--color-text-disabled)] mb-3">
            <span>{formatReviewDate(cur.created || '')}</span>
            <span>{current + 1}/{queue.length}</span>
          </div>

          {/* 第二行：标题加 imp|score */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--color-text-heading)]">{cur.name}</h2>
            <div className="text-xs text-[var(--color-text-disabled)] flex items-center gap-2 flex-shrink-0 ml-4">
              <span>imp {cur.importance ?? '—'}</span>
              <span>|</span>
              <span className="text-[var(--color-primary)] font-medium">score {cur.score?.toFixed(2) ?? '—'}</span>
            </div>
          </div>

          {/* 状态标签 */}
          {statusMap[cur.id] && (
            <div className="mb-3">
              <span className={`text-xs px-2.5 py-0.5 rounded-full ${
                statusMap[cur.id] === '已精修' ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' : 'bg-[#FDF3E4] text-[#C97E2C]'
              }`}>
                {statusMap[cur.id]}
              </span>
            </div>
          )}

          {/* 正文 */}
          {editing ? (
            <textarea
              className="w-full bg-[var(--color-surface-elevated)] border border-[var(--color-primary)] rounded-xl p-4 text-sm leading-relaxed resize-none mb-4"
              rows={8}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
            />
          ) : (
            <div className="text-[var(--color-text-primary)] text-sm leading-relaxed whitespace-pre-wrap bg-[var(--color-surface-elevated)] rounded-xl p-4 border border-[var(--color-border-light)] max-h-72 overflow-y-auto mb-4">
              {fullBucket ? getContent(fullBucket) : '加载中…'}
            </div>
          )}

          {/* 分类选择 */}
          <div className="flex gap-2 items-center">
            <select
              value={categoryMap[cur.id] ?? ''}
              onChange={e => updateCategory(cur.id, e.target.value || null)}
              className="flex-1 bg-white text-[var(--color-text-primary)] text-xs sm:text-sm rounded-lg px-2.5 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-primary)]"
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
              className="w-24 sm:w-32 bg-white text-[var(--color-text-primary)] text-xs sm:text-sm rounded-lg px-2.5 py-2 border border-[var(--color-border)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>
        </div>
      )}

        {/* 操作按钮组 */}
        {cur && (
          <div className="grid grid-cols-4 gap-2 mb-2">
            <button onClick={() => updateStatus(cur.id, '已精修')} disabled={savingStatus}
              className="py-2.5 rounded-xl bg-[var(--color-digested-bg)] border border-[#C5E0C3] text-[var(--color-digested)] hover:bg-[#D4EAD2] text-xs sm:text-sm font-semibold disabled:opacity-50"
            >✓ 已阅</button>
            <button onClick={() => updateStatus(cur.id, '存疑')} disabled={savingStatus}
              className="py-2.5 rounded-xl bg-[#FDF3E4] border border-[#F2D9B6] text-[#C97E2C] hover:bg-[#FBE9D0] text-xs sm:text-sm font-semibold disabled:opacity-50"
            >? 存疑</button>
            <button onClick={handleDelete} disabled={savingStatus}
              className="py-2.5 rounded-xl bg-[#FCE8E7] border border-[#F0C0BF] text-[var(--color-danger)] hover:bg-[#FADAD9] text-xs sm:text-sm font-semibold disabled:opacity-50"
            >🗑 删除</button>
            {editing ? (
              <>
                <button onClick={cancelEdit}
                  className="py-2.5 rounded-xl bg-[var(--color-surface-tertiary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[#E8E4DC] text-xs sm:text-sm font-semibold"
                >取消</button>
                <button onClick={saveEdit} disabled={savingEdit}
                  className="py-2.5 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] text-xs sm:text-sm font-semibold disabled:opacity-50"
                >保存</button>
              </>
            ) : (
              <button onClick={startEdit}
                className="py-2.5 rounded-xl bg-[var(--color-resolved-bg)] border border-[#C8DAF0] text-[var(--color-resolved)] hover:bg-[#E0ECF8] text-xs sm:text-sm font-semibold"
              >✎ 编辑</button>
            )}
          </div>
        )}
      </div>

      {/* Fixed bottom pagination */}
      <div className="flex-shrink-0">
        {queue.length > 1 && (
          <div className="flex justify-between">
            <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
              className="px-5 py-2 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-40 text-sm"
            >← 上一条</button>
            <button onClick={() => setCurrent(c => Math.min(queue.length - 1, c + 1))} disabled={current === queue.length - 1}
              className="px-5 py-2 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-40 text-sm"
            >下一条 →</button>
          </div>
        )}
      </div>
    </div>
  )
}
// ==================== 主页组件 ====================
function HomeClient() {
 
  const searchParams = useSearchParams()
  const router = useRouter()

  // 从 URL 直接读取 tab，默认 timeline
  const activeTab = (searchParams.get('tab') as 'timeline' | 'grid' | 'review') || 'timeline'
  // 从 sessionStorage 恢复缓存，避免重新挂载时白屏
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
  const toggleDateCollapse = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const toggleMonthCollapse = (month: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      next.has(month) ? next.delete(month) : next.add(month);
      return next;
    });
  };
  const [selected, setSelected] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const detailCache = useRef<Map<string, BucketDetail>>(new Map())
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
  fetch('/api/buckets?full=1')
    .then(r => r.json())
    .then(data => {
      const arr = Array.isArray(data) ? data : []
      try { sessionStorage.setItem('ombra_buckets', JSON.stringify(arr)) } catch {}
      setBuckets(arr)
    })
, []);

  useEffect(() => {
    // 1. 客户端优先从 sessionStorage 恢复缓存（不参与 SSR，避免 hydration 不一致）
    try {
      const cached = sessionStorage.getItem('ombra_buckets')
      if (cached) {
        const arr = JSON.parse(cached)
        if (Array.isArray(arr) && arr.length > 0) {
          setBuckets(arr)
          setLoading(false)
        }
      }
    } catch {}

    // 2. 后台拉取最新数据
    fetchBuckets().then(() => setLoading(false))
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem('review_state')
    if (raw) {
      try {
        const data = JSON.parse(raw)
        setCategoryMap(data.categoryMap ?? {})
        setCategories(data.categories ?? [])
      } catch {}
    }
  }, [])

  useEffect(() => {
    setQuickFilter('all')
    setActiveTag(null)
  }, [activeTab])

  const doSearch = async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return }
    setSearchLoading(true)
    setQuickFilter('all'); setActiveTag(null); setDatePreset('all')
    setCustomStart(''); setCustomEnd('')

    // Tokenize: split by whitespace, then each token as exact substring
    const tokens = q.trim().split(/\s+/).filter(t => t.length >= 1)
    const qLower = q.trim().toLowerCase()
    const results = buckets.filter(b => {
      const haystack = [
        b.name || '',
        ...(b.domain || []),
        ...(b.tags || []),
        b.content_preview || '',  // full content via ?full=1
      ].join(' ').toLowerCase()
      // Try whole query first, then individual tokens
      if (haystack.includes(qLower)) return true
      if (tokens.length > 1) return tokens.some(t => haystack.includes(t.toLowerCase()))
      return false
    })

    setSearchResults(results.map(b => ({
      ...b,
      score: b.score ?? 0,
      created: b.created || new Date().toISOString(),
    })))
    setSearchLoading(false)
  }

  const openBucket = async (id: string) => {
    setEditing(false)
    // 缓存命中 → 瞬时打开，不请求
    if (detailCache.current.has(id)) {
      setSelected(detailCache.current.get(id)!)
      return
    }
    // 首次打开：不清空上一个选中数据，只显示 loading，避免闪烁
    setDetailLoading(true)
    const data = await fetch(`/api/bucket/${id}`).then(r => r.json())
    detailCache.current.set(id, data)
    setSelected(data)
    setDetailLoading(false)
  }

  const traceOp = async (id: string, args: Record<string, unknown>) => {
    // Optimistic update for noise/resolved toggle — instant UI feedback
    // 噪声／解决状态乐观更新 — 立即反馈
    if (selected && selected.id === id && 'resolved' in args) {
      setSelected(prev => prev ? {
        ...prev,
        metadata: { ...prev.metadata, resolved: Boolean(args.resolved), importance: args.importance != null ? Number(args.importance) : prev.metadata.importance },
        noise: Boolean(args.resolved) && (args.importance != null ? Number(args.importance) : prev.metadata.importance) === 1,
      } : prev)
    }

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
    detailCache.current.set(id, detail)
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
    detailCache.current.delete(selected.id)  // 清缓存让 openBucket 重新拉
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

  const monthlyGroups = useMemo(() => groupByMonth(displayed), [displayed]);


  function ImpSignal({ importance }: { importance: number | string | undefined }) {
    const maxBars = 5
    const num = Number(importance)
    if (importance == null || isNaN(num)) {
      return <span className="text-xs text-[var(--color-text-disabled)] font-medium">—</span>
    }
    const value = Math.max(0, Math.min(num, 10)) / 2
    const fullBars = Math.floor(value)
    const remainder = value - fullBars

    return (
      <div className="flex items-center">
        <div className="flex gap-px">
          {Array.from({ length: maxBars }).map((_, i) => {
            let opacity: number
            if (i < fullBars) {
              opacity = 1
            } else if (i === fullBars && remainder > 0) {
              opacity = 0.3 + remainder * 0.7
            } else {
              opacity = 0.12
            }
            return (
              <div
                key={i}
                className="w-1 h-2 rounded-[1px]"
                style={{
                  backgroundColor: `rgba(217, 119, 87, ${opacity})`,
                }}
              />
            )
          })}
        </div>
        <span className="text-xs text-[var(--color-primary)] font-medium tabular-nums leading-none ml-0.5">
          {Math.round(num)}
        </span>
      </div>
    )
  }
  const BucketCard = ({ b }: { b: Bucket }) => (
  <div
    onClick={() => openBucket(b.id)}
    className={`bg-gradient-to-br from-white to-slate-50/50 rounded-2xl p-4 sm:p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.02)] hover:-translate-y-0.5 cursor-pointer border transition-all duration-300 group w-full relative active:scale-[0.985] touch-pan-y ${
      (b.noise || (b.resolved && b.importance === 1))
        ? 'border-[var(--color-border)] opacity-50 saturate-50'
        : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30'
    }`}
  >
    <div className="flex items-start justify-between mb-1 gap-2 sm:gap-3">
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap pr-14 sm:pr-0">
        {b.pinned && <span className="text-[var(--color-primary)] text-xs sm:text-sm flex-shrink-0">★</span>}
        <span className="font-semibold text-[var(--color-text-primary)] text-sm sm:text-base truncate group-hover:text-[var(--color-primary)] transition-colors">
          {b.name}
        </span>
        {isFeel(b) && <StatusBadge type="feel" />}
        {b.digested && <StatusBadge type="digested" />}
        {b.resolved && !(b.noise || (b.resolved && b.importance === 1)) && <StatusBadge type="resolved" />}
        {b.type === 'archived' && <StatusBadge type="archived" />}
        {(b.noise || (b.resolved && b.importance === 1)) && (
          <StatusBadge type="noise" onClick={() => {
            // 乐观更新：立即从本地列表移除 noise 状态
            setBuckets(prev => prev.map(bucket =>
              bucket.id === b.id
                ? { ...bucket, noise: false, resolved: false, importance: bucket.importance }
                : bucket
            ))
            traceOp(b.id, { resolved: false })
          }} />
        )}
        {b.wish && <StatusBadge type="wish" />}
        {b.todo && !b.todo_done && <span title={`待办：${b.todo}`} className="text-xs text-[var(--color-primary)] flex-shrink-0">☐</span>}
      </div>
      <div className="absolute top-3 right-3 sm:static flex flex-col items-end gap-1.5 flex-shrink-0">
        <div className="min-w-[48px] sm:min-w-[56px] bg-[#FFF5F2] rounded-full px-2 sm:px-2.5 py-0.5 flex items-center justify-center">
          <span className="text-xs text-[var(--color-primary)] font-medium leading-tight">
            score {b.score != null ? b.score.toFixed(1) : '—'}
          </span>
        </div>
        <ImpSignal importance={b.importance} />
      </div>
    </div>
    <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] line-clamp-2 mb-2.5 sm:mb-4 leading-relaxed pr-16 sm:pr-20">
      {b.content_preview}
    </p>

    <div className="flex items-end justify-between mb-0 gap-2 sm:gap-3">
      <div className="flex flex-wrap gap-1 sm:gap-1.5">
        {(b.domain ?? []).map(d => (
          <span key={d} className="text-xs bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[var(--color-text-secondary)]">{d}</span>
        ))}
        {(b.tags ?? []).slice(0, 2).map(t => (
          <span key={t} className="text-xs border border-[var(--color-border)] px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-[var(--color-text-tertiary)]">{t}</span>
        ))}
        {(b.tags ?? []).length > 2 && (
          <span className="text-xs text-[var(--color-text-disabled)] py-0.5 px-1">+{(b.tags ?? []).length - 3}</span>
        )}
      </div>
      {b.last_active && (
        <span className="text-xs text-[var(--color-text-disabled)] flex-shrink-0">
           {formatBeijingDate(b.last_active)}
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
          <span className="text-sm sm:text-base font-semibold text-[var(--color-text-primary)] italic">{title}</span>
          <span className="text-xs text-[var(--color-text-disabled)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md">{sortedItems.length} 条</span>
          <div className="flex-1 h-px bg-[var(--color-border)]"></div>
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

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const statusCounts = useMemo(() => {
    const list = searchResults ?? buckets
    return {
      all: list.length,
      pinned: list.filter(b => b.pinned).length,
      important: list.filter(b => Number(b.importance) >= 7 && !b.pinned).length,
      feel: list.filter(b => isFeel(b)).length,
      digested: list.filter(b => !!b.digested).length,
      resolved: list.filter(b => b.resolved).length,
      archived: list.filter(b => b.type === 'archived').length,
      noise: list.filter(b => !!b.noise || (b.resolved && b.importance === 1)).length,
      other: list.filter(b => !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested && !isFeel(b) && !(!!b.noise || (b.resolved && b.importance === 1))).length,
    }
  }, [searchResults, buckets])

  if (loading && buckets.length === 0) return <div className="flex items-center justify-center h-screen bg-[var(--color-bg)] text-[var(--color-text-tertiary)]">读取中...</div>

  return (
    <div className={`min-h-screen ${activeTab === 'review' ? 'flex flex-col' : ''} bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans selection:bg-[var(--color-primary)] selection:text-white pb-20`}>
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <NavBar activeSlug={activeTab} onTabClick={(tab) => router.replace(`/?tab=${tab}`, { scroll: false })} />

      {/* Mobile-only header */}
      <header className="md:hidden sticky top-0 z-10 bg-[var(--color-bg)]/80 backdrop-blur-sm border-b border-[var(--color-border)] px-3 h-12 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#E8A58F]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Ombre Brain</span>
        </div>
        {activeTab !== 'review' && <MobileViewSwitch />}
      </header>

      <main className={`max-w-6xl mx-auto px-3 sm:px-6 pt-4 sm:pt-10 ${activeTab === 'review' ? 'flex flex-col flex-1 min-h-0 pb-4' : ''}`}>
        {activeTab !== 'review' && (
          <div className="hidden md:block mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[var(--color-text-heading)] mb-2 sm:mb-3">
              {activeTab === 'timeline' ? '时间线' : '记忆格'}
            </h1>
            <p className="text-[var(--color-text-tertiary)] text-xs sm:text-sm">
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
            <div className="bg-white border border-[var(--color-border)] rounded-2xl p-3 sm:p-4 shadow-sm mb-4">
              <div className="relative w-full mb-3 sm:mb-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-disabled)]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="8.5" cy="8.5" r="6" /><path d="M13.5 13.5L18 18" />
                </svg>
                <input
                  className="w-full bg-[var(--color-surface-secondary)] border border-transparent rounded-xl pl-8 pr-4 py-2.5 text-sm outline-none focus:bg-white focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all placeholder-[var(--color-text-disabled)]"
                  placeholder="搜索记忆、标签或内容..."
                  value={search}
                  onChange={e => {
                    const val = e.target.value
                    setSearch(val)
                    clearTimeout(searchTimerRef.current)
                    if (!val.trim()) {
                      setSearchResults(null)   // 立即清空，不等 debounce
                      return
                    }
                    searchTimerRef.current = setTimeout(() => {
                      doSearch(val)
                    }, 300)
                }}
                />
              </div>
              <div className="w-full h-px bg-[var(--color-border-light)] mb-3 sm:mb-4"></div>

              <FilterBar>
                {QUICK_FILTERS.map(f => (
                  <FilterPill key={f.key} label={`${f.label} ${statusCounts[f.key]}`} active={quickFilter === f.key} onClick={() => setQuickFilter(f.key)} />
                ))}
              </FilterBar>

              {/* 下排：分类标签 */}
              {categories.length > 0 && (
                <div className="flex gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar mt-3">
                    {/* “全部” 按钮 */}
                    <button onClick={() => setActiveCategory('')}
                      // 加上了 transition-all 确保动画一致
                      className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full transition-all border whitespace-nowrap ${
                        // 统一了选中与未选中的边框颜色及 hover 效果
                        activeCategory === '' 
                          ? 'bg-[var(--color-text-primary)] border-[var(--color-text-primary)] text-white' 
                          : 'bg-white border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[#C4C1BC] hover:bg-[var(--color-surface-secondary)]'
                      }`}>
                      全部
                    </button>
                    
                    {/* 动态分类循环 */}
                    {categories.map(c => (
                      <button key={c} onClick={() => setActiveCategory(c)}
                        // 加上了 transition-all 确保动画一致
                        className={`flex-shrink-0 text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full transition-all border whitespace-nowrap ${
                          // 统一了选中与未选中的边框颜色及 hover 效果
                          activeCategory === c 
                            ? 'bg-[var(--color-text-primary)] border-[var(--color-text-primary)] text-white' 
                            : 'bg-white border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[#C4C1BC] hover:bg-[var(--color-surface-secondary)]'
                        }`}>{c}</button>
                    ))}
                  </div>
                )}

              {activeTab === 'grid' && (
                <div className="flex gap-1.5 sm:gap-2 mt-4 pt-4 border-t border-[var(--color-border-light)] overflow-x-auto no-scrollbar">
                  <button onClick={() => setActiveTag(activeTag === 'feel' ? null : 'feel')}
                    className={`text-xs px-2.5 sm:px-3 py-1 rounded-md whitespace-nowrap ${
                      activeTag === 'feel' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)]'
                    }`}>
                    feel
                  </button>
                  {topTags.map(t => (
                    <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)}
                      className={`text-xs px-2.5 sm:px-3 py-1 rounded-md whitespace-nowrap ${
                        activeTag === t ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)]'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

                        {/* 工具条 */}
            <div className={`flex items-center gap-2 sm:gap-3 mb-6 px-1 ${
              activeTab === 'timeline' ? 'justify-between' : 'justify-end'
            }`}>
              {/* 新增：如果是时间线模式，把首个月份标题顶到工具条左侧的空白处 */}
              {activeTab === 'timeline' && (
                monthlyGroups.length > 0 ? (
                  <div className="flex items-center gap-2 ml-[calc(1rem-7px)] translate-y-[8px] cursor-pointer select-none" onClick={() => toggleMonthCollapse(monthlyGroups[0].month)}>
                    <h2 className="text-xl font-bold italic font-serif text-[var(--color-primary)] leading-tight whitespace-nowrap">
                      {monthlyGroups[0].month.replace('-', '·')}
                    </h2>
                    <span className="text-xs text-[var(--color-text-disabled)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md">
                      {monthlyGroups[0].days.reduce((sum, d) => sum + d.items.length, 0)} 条
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-disabled)] ml-1">暂无记录</div>
                )
              )}

              {/* 时间选择器 */}
              <div className="flex items-center gap-2 bg-white/40 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-[var(--color-border)] shadow-sm">
                <span className="text-xs text-[var(--color-text-disabled)] hidden sm:inline">时间</span>
                <select
                  className="text-xs bg-transparent outline-none text-[var(--color-text-secondary)] cursor-pointer"
                  value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}>
                  {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                {datePreset === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                      className="bg-white rounded px-1.5 py-0.5 text-xs border border-[var(--color-border)]" />
                    <span className="text-[var(--color-text-disabled)]">-</span>
                    <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                      className="bg-white rounded px-1.5 py-0.5 text-xs border border-[var(--color-border)]" />
                  </div>
                )}
              </div>

              {/* 记忆格视图特有控件 */}
              {activeTab === 'grid' && (
                <>
                  <button onClick={() => setGridViewMode(gridViewMode === 'list' ? 'card' : 'list')}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-white/60 backdrop-blur-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"
                  >{gridViewMode === 'list' ? '⧉' : '☰'}</button>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-white/60 backdrop-blur-sm text-[var(--color-text-secondary)] outline-none cursor-pointer">
                    <option value="score">权重</option>
                    <option value="importance">重要度</option>
                    <option value="created">时间</option>
                  </select>
                  <button onClick={() => setSortOrder(order => order === 'desc' ? 'asc' : 'desc')}
                    className={`text-xs px-2.5 py-1.5 rounded-md border ${sortOrder === 'desc' ? 'bg-[var(--color-primary)] text-white' : 'bg-white/60 backdrop-blur-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}`}
                  >{sortOrder === 'desc' ? '↓降序' : '↑升序'}</button>
                </>
              )}
            </div>

            {/* 时间线 - 渲染区域 */}
            {activeTab === 'timeline' ? (
              <div>
                {monthlyGroups.map(({ month, days }, index) => {
                  const isMonthCollapsed = collapsedMonths.has(month);
                  return (
                    <div key={month} className="mb-8">
                      {/* 核心改动：只有非第一个月份（index > 0），才在下方单独渲染月份标题行 */}
                      {index > 0 && (
                        <div className="flex items-center gap-2 mb-4 ml-[calc(1rem-7px)] cursor-pointer select-none" onClick={() => toggleMonthCollapse(month)}>
                          <h2 className="text-xl font-bold italic font-serif text-[var(--color-primary)] leading-tight whitespace-nowrap">
                            {month.replace('-', '·')}
                          </h2>
                          <span className="text-xs text-[var(--color-text-disabled)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md">
                            {days.reduce((sum, d) => sum + d.items.length, 0)} 条
                          </span>
                        </div>
                      )}

                      {/* 日期列表（折叠时隐藏） */}
                      {!isMonthCollapsed && (
                        <div className={`relative pl-2 ${index === 0 ? 'mt-0' : 'mt-1'}`}>
                          {days.map(({ date, items }) => {
                            const isDayCollapsed = collapsedDates.has(date);
                            return (
                              <div key={date} className="relative pl-2 mb-6">
                                {/* 折叠箭头 */}
                                <button
                                  onClick={() => toggleDateCollapse(date)}
                                  className="absolute -left-[7px] top-2 -translate-y-1/2 text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] transition-colors z-[1]"
                                >
                                  <span className={`leading-none ${isDayCollapsed ? 'text-xs' : 'text-sm'}`}>
                                    {isDayCollapsed ? '▶︎' : '▼︎'}
                                  </span>
                                </button>

                                {/* 日期标签 */}
                                <button
                                  onClick={() => toggleDateCollapse(date)}
                                  className="flex items-center gap-3 mb-4 ml-1 cursor-pointer hover:text-[var(--color-primary)] transition-colors text-left w-full"
                                >
                                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                                    {formatDateGroup(date)}
                                  </span>
                                  <span className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 rounded-md font-medium">
                                    {items.length} 条
                                  </span>
                                </button>

                                {!isDayCollapsed && (
                                  <>
                                    {/* 极细空气线 */}
                                    <div className="absolute left-0 top-2.5 bottom-0 w-[1px] bg-slate-200/60" />
                                    {/* 空心呼吸圆点 */}
                                    <div className="absolute left-0 top-2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-[var(--color-primary)] bg-white ring-4 ring-orange-50 shadow-[0_0_6px_rgba(217,119,87,0.15)] z-[1]" />
                                    <div className="space-y-3 ml-1">
                                      {items.map(b => <BucketCard key={b.id} b={b} />)}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                {quickFilter === 'all' ? (
                  <>
                    <GridSection title="★ 钉选记忆" items={displayed.filter(b => b.pinned)} />
                    <GridSection title="♦ 重要 (imp ≥ 7)" items={displayed.filter(b => !b.pinned && Number(b.importance) >= 7 && !b.resolved && !b.digested)} />
                    <GridSection title="feel" items={displayed.filter(b => !b.pinned && isFeel(b) && !b.resolved && !b.digested)} />
                    <GridSection title="已解决" items={displayed.filter(b => !b.pinned && b.resolved)} />
                    <GridSection title="已消化" items={displayed.filter(b => !b.pinned && !b.resolved && b.digested)} />
                    <GridSection title="已归档" items={displayed.filter(b => b.type === 'archived')} />
                    <GridSection title="其他记忆" items={displayed.filter(b => !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested && !isFeel(b))} />
                  </>
                ) : (
                  <GridSection title={QUICK_FILTERS.find(f => f.key === quickFilter)?.label || ''} items={displayed} />
                )}
              </div>
            )}
            {displayed.length === 0 && (
              <div className="text-center text-[var(--color-text-disabled)] py-20 text-sm bg-white rounded-2xl border border-dashed border-[var(--color-border)]">
                没有找到对应的记录
              </div>
            )}
          </>
        )}
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
        onStartEdit={(content) => { setEditing(true); setEditContent(content) }}
        onCancelEdit={() => setEditing(false)}
        onSaveEdit={saveEdit}
        onTraceOp={traceOp}
        onCopyId={copyId}
        onTouch={async (id) => {
          await fetch(`/api/touch/${id}`, { method: 'POST' })
        }}
        onArchive={async (id) => {
          const res = await fetch(`/api/archive/${id}`, { method: 'POST' })
          const data = await res.json()
          if (data.ok) {
            setSelected(null)
            const fresh = await fetch('/api/buckets').then(r => r.json())
            setBuckets(fresh)
          }
        }}
        onActivate={async (id) => {
          await fetch(`/api/touch/${id}?ripple=true`, { method: 'POST' })
        }}
        onConvertToJournal={async (id, args) => {
          const res = await fetch('/api/to-journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...args }),
          })
          const data = await res.json()
          if (data.ok) {
            setSelected(null)
            const fresh = await fetch('/api/buckets').then(r => r.json())
            setBuckets(fresh)
          } else {
            alert(data.error ?? '转换失败')
          }
        }}
      />

      {/* 悬浮加号 */}
      {activeTab !== 'review' && (
        <button onClick={() => setShowAdd(true)}
          className="fixed bottom-28 md:bottom-8 right-4 sm:right-8 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[var(--color-primary)] text-white text-xl sm:text-2xl shadow-lg hover:bg-[var(--color-primary-hover)] active:scale-90 transition-all flex items-center justify-center z-50">
          +
        </button>
      )}

      {/* 新增弹窗 */}
      <DetailPanel open={showAdd} onClose={() => setShowAdd(false)} mode="modal" width="max-w-lg">
        <h3 className="text-[var(--color-text-primary)] font-semibold mb-4">新增记忆</h3>
            <input placeholder="标题（可选）" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--color-primary)]" />
            <textarea placeholder="内容…" value={addForm.content} onChange={e => setAddForm(f => ({ ...f, content: e.target.value }))}
              rows={5} className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm mb-3 resize-none focus:outline-none focus:border-[var(--color-primary)]" />
            <input placeholder="标签（逗号分隔）" value={addForm.tags} onChange={e => setAddForm(f => ({ ...f, tags: e.target.value }))}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-[var(--color-primary)]" />
            <div className="flex items-center gap-3 mb-5">
              <span className="text-sm text-[var(--color-text-tertiary)]">重要度</span>
              <input type="range" min={1} max={10} value={addForm.importance} onChange={e => setAddForm(f => ({ ...f, importance: Number(e.target.value) }))}
                className="flex-1 accent-[var(--color-primary)]" />
              <span className="text-sm text-[var(--color-text-primary)] w-4">{addForm.importance}</span>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[var(--color-text-tertiary)]">取消</button>
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
                className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-40 hover:bg-[var(--color-primary-hover)] transition-colors">
                {adding ? '存入中…' : '存入记忆'}
              </button>
            </div>
          </DetailPanel>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-[var(--color-bg)] text-[var(--color-text-tertiary)]">加载中...</div>}>
      <HomeClient />
    </Suspense>
  )
}