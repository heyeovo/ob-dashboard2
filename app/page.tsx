'use client'

import { useEffect, useState, useMemo } from 'react'

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
  (b.domain ?? []).includes('feel') || (b.tags ?? []).includes('feel')

function matchesQuickFilter(b: Bucket, f: QuickFilter): boolean {
  switch (f) {
    case 'all': return true
    case 'pinned': return b.pinned
    case 'important': return Number(b.importance) >= 7
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

function formatDateGroup(dateStr: string) {
  if (dateStr === 'unknown') return '未知时间'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return '未知时间'
  const mon = d.toLocaleDateString('en', { month: 'short' })
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getDate()} ${mon} · 周${weekday}`
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

export default function Home() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'grid'>('timeline')
  
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
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)

  const [gridViewMode, setGridViewMode] = useState<'list' | 'card'>('list')
  const [sortByImportance, setSortByImportance] = useState(false)

  const fetchBuckets = () =>
    fetch('/api/buckets').then(r => r.json()).then(data => setBuckets(data))

  useEffect(() => { fetchBuckets().then(() => setLoading(false)) }, [])

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
    const raw = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json())
    const enriched = raw.map((item: any) => {
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
    setSearchLoading(false)
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
    (!activeTag || (b.tags ?? []).includes(activeTag))
  )

  const grouped = useMemo(() => groupByDate(displayed), [displayed])

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  const BucketCard = ({ b }: { b: Bucket }) => (
    <div
      onClick={() => openBucket(b.id)}
      className="bg-white rounded-xl p-5 hover:shadow-md cursor-pointer border border-[#E8E6E1] hover:border-[#D97757]/30 transition-all duration-200 group w-full"
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {b.pinned && <span className="text-[#D97757] text-sm flex-shrink-0">★</span>}
          <span className="font-semibold text-[#3A3836] text-base truncate group-hover:text-[#D97757] transition-colors">{b.name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFeel(b) && <span className="text-xs bg-[#FDF0ED] text-[#D97757] px-2 py-0.5 rounded-full font-medium">feel</span>}
          {b.resolved && <span className="text-xs bg-[#F4F2EC] text-[#8A8681] px-2 py-0.5 rounded-full">归档</span>}
          {b.digested && <span className="text-xs bg-[#EAF5E9] text-[#478B4A] px-2 py-0.5 rounded-full">已消化</span>}
          <span className="text-xs text-[#A8A49D] font-medium">{Number(b.importance) > 0 ? `imp ${Number(b.importance)}` : '—'}</span>
        </div>
      </div>
      <p className="text-sm text-[#6C6965] line-clamp-2 mb-4 leading-relaxed">{b.content_preview}</p>
      <div className="flex flex-wrap gap-1.5">
        {(b.domain ?? []).map(d => (
          <span key={d} className="text-xs bg-[#F4F2EC] px-2 py-1 rounded-md text-[#5B5854]">{d}</span>
        ))}
        {(b.tags ?? []).slice(0, 3).map(t => (
          <span key={t} className="text-xs border border-[#E8E6E1] px-2 py-1 rounded-md text-[#8A8681]">{t}</span>
        ))}
        {(b.tags ?? []).length > 3 && (
          <span className="text-xs text-[#A8A49D] py-1 px-1">+{(b.tags ?? []).length - 3}</span>
        )}
      </div>
    </div>
  )

  const GridSection = ({ title, items }: { title: string, items: Bucket[] }) => {
    if (items.length === 0) return null;
    const sortedItems = sortByImportance
      ? [...items].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
      : items;
    return (
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-5">
          <span className="text-base font-semibold text-[#3A3836] italic">{title}</span>
          <span className="text-xs text-[#A8A49D] bg-[#F4F2EC] px-2 py-0.5 rounded-md">{sortedItems.length} 条</span>
          <div className="flex-1 h-px bg-[#E8E6E1]"></div>
        </div>
        {gridViewMode === 'list' ? (
          <div className="space-y-3">
            {sortedItems.map(b => <BucketCard key={b.id} b={b} />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
      important: list.filter(b => Number(b.importance) >= 7).length,
      feel: list.filter(b => isFeel(b)).length,
      digested: list.filter(b => !!b.digested).length,
      resolved: list.filter(b => b.resolved).length,
    }
  }, [searchResults, buckets])

  if (loading) return <div className="flex items-center justify-center h-screen bg-[#FCFAF8] text-[#8A8681]">读取中...</div>

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans selection:bg-[#D97757] selection:text-white pb-20">
      
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-8 text-sm font-medium text-[#8A8681]">
          <span className="text-[#3A3836] font-semibold flex items-center gap-2 mr-4">
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#D97757] to-[#E8A58F]"></div>
            Ombre Brain
          </span>
          <span 
            onClick={() => setActiveTab('timeline')} 
            className={`cursor-pointer transition-colors ${activeTab === 'timeline' ? 'text-[#3A3836] border-b-2 border-[#D97757] h-full flex items-center' : 'hover:text-[#3A3836] h-full flex items-center'}`}>
            时间线
          </span>
          <span 
            onClick={() => setActiveTab('grid')} 
            className={`cursor-pointer transition-colors ${activeTab === 'grid' ? 'text-[#3A3836] border-b-2 border-[#D97757] h-full flex items-center' : 'hover:text-[#3A3836] h-full flex items-center'}`}>
            记忆格
          </span>
          <span className="hover:text-[#3A3836] cursor-pointer transition-colors ml-auto">配置</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 pt-10">
        
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-[#2B2927] mb-3">
            {activeTab === 'timeline' ? '时间线' : '记忆格'}
          </h1>
          <p className="text-[#8A8681] text-sm">
            {activeTab === 'timeline' 
              ? `沿时间回溯，当前展示 ${displayed.length} 条记录` 
              : `分类整理与检索 · ${buckets.length} 格`}
          </p>
        </div>

        <div className="bg-white border border-[#E8E6E1] rounded-2xl p-4 shadow-sm mb-8">
          <div className="relative w-full mb-4">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A49D]">🔍</span>
            <input
              className="w-full bg-[#F9F8F6] border border-transparent rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:bg-white focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]/10 transition-all placeholder-[#A8A49D]"
              placeholder="搜索记忆、标签或内容..."
              value={search}
              onChange={e => doSearch(e.target.value)}
            />
          </div>

          <div className="w-full h-px bg-[#F0EFEB] mb-4"></div>

          <div className="flex flex-wrap items-center gap-y-3 gap-x-6">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              <span className="text-xs text-[#A8A49D] font-medium self-center mr-1">状态</span>
              {QUICK_FILTERS.map(f => (
                <button key={f.key} onClick={() => setQuickFilter(f.key)}
                  className={`flex-shrink-0 text-xs px-3.5 py-1.5 rounded-full transition-all border ${
                    quickFilter === f.key 
                      ? 'bg-[#3A3836] border-[#3A3836] text-white' 
                      : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:border-[#C4C1BC] hover:bg-[#F9F8F6]'
                  }`}>
                  {f.label} {statusCounts[f.key]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-[#A8A49D] font-medium">时间</span>
              <select className="bg-white rounded-lg px-3 py-1.5 text-xs outline-none text-[#5B5854] border border-[#E8E6E1] focus:border-[#D97757] hover:border-[#C4C1BC] cursor-pointer transition-colors"
                value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}>
                {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {datePreset === 'custom' && (
                <div className="flex items-center gap-1">
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                    className="bg-white rounded-lg px-2 py-1.5 text-xs outline-none text-[#5B5854] border border-[#E8E6E1]" />
                  <span className="text-[#A8A49D] text-xs">-</span>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    className="bg-white rounded-lg px-2 py-1.5 text-xs outline-none text-[#5B5854] border border-[#E8E6E1]" />
                </div>
              )}
              {activeTab === 'grid' && (
                <>
                  <div className="w-px h-4 bg-[#E8E6E1] ml-1 mr-1"></div>
                  <button
                    onClick={() => setGridViewMode(gridViewMode === 'list' ? 'card' : 'list')}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[#E8E6E1] bg-white text-[#6C6965] hover:bg-[#F9F8F6] transition-colors"
                  >
                    {gridViewMode === 'list' ? '⧉ 卡片' : '☰ 列表'}
                  </button>
                  <button
                    onClick={() => setSortByImportance(!sortByImportance)}
                    className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                      sortByImportance
                        ? 'bg-[#D97757] border-[#D97757] text-white'
                        : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                    }`}
                  >
                    ↓ 重要度
                  </button>
                </>
              )}
            </div>
          </div>

          {activeTab === 'grid' && topTags.length > 0 && (
            <div className="flex gap-2 mt-4 pt-4 border-t border-[#F0EFEB] overflow-x-auto no-scrollbar items-center">
              <span className="text-xs text-[#A8A49D] font-medium mr-1 flex-shrink-0">分类</span>
              {topTags.map(t => (
                <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)}
                  className={`flex-shrink-0 text-xs px-3 py-1 rounded-md transition-all ${
                    activeTag === t 
                      ? 'bg-[#D97757] text-white font-medium shadow-sm' 
                      : 'text-[#8A8681] hover:bg-[#F4F2EC] hover:text-[#5B5854]'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === 'timeline' ? (
          <div className="space-y-8 w-full">
            {grouped.map(({ date, items }) => {
              const expanded = expandedDates.has(date)
              const isSearching = search.trim().length > 0
              const shown = (expanded || isSearching) ? items : items.slice(0, 3)
              const rest = items.length - 3
              return (
                <div key={date} className="relative pl-4">
                  <div className="absolute left-0 top-2 bottom-0 w-px bg-[#E8E6E1]"></div>
                  <div className="absolute left-[-3px] top-2.5 w-1.5 h-1.5 rounded-full bg-[#D97757]"></div>
                  
                  <div className="flex items-center gap-3 mb-4 ml-4">
                    <span className="text-sm font-semibold text-[#3A3836]">{formatDateGroup(date)}</span>
                    <span className="text-xs text-[#A8A49D] bg-[#F4F2EC] px-2 py-0.5 rounded-md">{items.length} 条</span>
                  </div>
                  
                  <div className="space-y-3 ml-4">
                    {shown.map(b => <BucketCard key={b.id} b={b} />)}
                  </div>
                  
                  {!isSearching && rest > 0 && (
                    <button onClick={() => toggleDate(date)}
                      className="mt-4 ml-4 text-xs font-medium text-[#D97757] hover:text-[#B65D40] transition-colors flex items-center gap-1">
                      {expanded ? '↑ 收起内容' : `↓ 展开剩余 ${rest} 条`}
                    </button>
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
              <GridSection 
                title={QUICK_FILTERS.find(f => f.key === quickFilter)?.label || '筛选结果'} 
                items={displayed} 
              />
            )}
          </div>
        )}

        {displayed.length === 0 && (
          <div className="text-center text-[#A8A49D] py-20 text-sm bg-white rounded-2xl border border-[#E8E6E1] border-dashed">
            没有找到对应的记录
          </div>
        )}
      </main>

      {/* 详情抽屉 */}
      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end"
          onClick={() => { setSelected(null); setEditing(false) }}>
          <div className="absolute inset-0 bg-[#3A3836]/20 backdrop-blur-sm transition-opacity" />
          
          <div className="relative bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl transform transition-transform"
            onClick={e => e.stopPropagation()}>
            
            {detailLoading ? (
              <div className="flex items-center justify-center h-full text-[#A8A49D]">读取中...</div>
            ) : selected && (
              <div className="p-8">
                <div className="flex items-start justify-between mb-8 pb-6 border-b border-[#F0EFEB]">
                  <div className="pr-4">
                    <div className="flex items-center gap-2 mb-2">
                      {selected.metadata.pinned && <span className="text-[#D97757] text-xl">★</span>}
                      <h2 className="text-2xl font-bold text-[#2B2927] leading-tight">{selected.metadata.name}</h2>
                    </div>
                    <div className="text-sm text-[#8A8681]">
                      {new Date(selected.metadata.created).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <button onClick={() => { setSelected(null); setEditing(false) }}
                    className="text-[#A8A49D] hover:text-[#3A3836] p-2 bg-[#F9F8F6] hover:bg-[#F0EFEB] rounded-full transition-colors flex-shrink-0">
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {[
                    { label: '重要度', value: `${selected.metadata.importance}/10` },
                    { label: '权重分', value: selected.score?.toFixed(1) ?? '—' },
                    { label: '激活次数', value: String(selected.metadata.activation_count ?? '—') },
                    { label: '状态', value: selected.metadata.resolved ? '已归档' : '活跃中' },
                  ].map(item => (
                    <div key={item.label} className="bg-[#F9F8F6] rounded-xl p-3 border border-[#F0EFEB]">
                      <div className="text-xs text-[#8A8681] mb-1">{item.label}</div>
                      <div className="text-sm font-semibold text-[#3A3836]">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 mb-8">
                  {(selected.metadata.domain ?? []).map(d => (
                    <span key={d} className="text-xs bg-[#EFECE6] px-3 py-1.5 rounded-md text-[#5B5854] font-medium">{d}</span>
                  ))}
                  {(selected.metadata.tags ?? []).map(t => (
                    <span key={t} className="text-xs border border-[#E8E6E1] px-3 py-1.5 rounded-md text-[#6C6965]">{t}</span>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3 mb-8 bg-[#FDFCFB] p-4 rounded-xl border border-[#F0EFEB]">
                  <button disabled={operating}
                    onClick={() => traceOp(selected.id, { pinned: selected.metadata.pinned ? 0 : 1 })}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      selected.metadata.pinned
                        ? 'bg-[#FDF0ED] text-[#D97757] hover:bg-[#FCE2DC]'
                        : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                    }`}>
                    {selected.metadata.pinned ? '取消钉选' : '★ 钉选记忆'}
                  </button>
                  <button disabled={operating}
                    onClick={() => traceOp(selected.id, { resolved: selected.metadata.resolved ? 0 : 1 })}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      selected.metadata.resolved
                        ? 'bg-[#EAF5E9] text-[#478B4A] hover:bg-[#DBEEDB]'
                        : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                    }`}>
                    {selected.metadata.resolved ? '取消归档' : '归档记忆'}
                  </button>
                  <button disabled={operating}
                    onClick={() => traceOp(selected.id, { digested: selected.metadata.digested ? 0 : 1 })}
                    className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      selected.metadata.digested
                        ? 'bg-[#EAF5E9] text-[#478B4A] hover:bg-[#DBEEDB]'
                        : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                    }`}>
                    {selected.metadata.digested ? '取消消化' : '标记消化'}
                  </button>
                  <div className="flex-1"></div>
                  <button disabled={operating}
                    onClick={() => {
                      if (confirm('确定抹除此记忆？不可恢复。')) {
                        traceOp(selected.id, { delete: true }).then(() => setSelected(null))
                      }
                    }}
                    className="text-sm px-4 py-2 rounded-lg font-medium text-[#C64B45] hover:bg-[#FDF1F0] transition-colors disabled:opacity-50">
                    抹除
                  </button>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-[#2B2927]">内容核心</h3>
                    {!editing ? (
                      <button onClick={() => { setEditing(true); setEditContent(selected.content) }}
                        className="text-sm text-[#D97757] hover:text-[#B65D40] font-medium transition-colors">编辑</button>
                    ) : (
                      <div className="flex gap-3">
                        <button onClick={() => setEditing(false)} className="text-sm text-[#8A8681] hover:text-[#3A3836]">取消</button>
                        <button onClick={saveEdit} disabled={saving}
                          className="text-sm bg-[#D97757] text-white px-4 py-1.5 rounded-lg hover:bg-[#C46445] transition-colors disabled:opacity-50 shadow-sm">
                          {saving ? '保存中...' : '保存更改'}
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {editing ? (
                    <textarea className="w-full bg-[#FDFCFB] border border-[#E8E6E1] rounded-xl p-5 text-[#3A3836] text-base leading-relaxed resize-none outline-none focus:ring-2 focus:ring-[#D97757]/20 focus:border-[#D97757] shadow-inner"
                      rows={18} value={editContent} onChange={e => setEditContent(e.target.value)} />
                  ) : (
                    <div className="bg-[#FDFCFB] border border-[#E8E6E1] rounded-xl p-6 text-[#3A3836] text-base leading-loose whitespace-pre-wrap shadow-sm">
                      {selected.content}
                    </div>
                  )}
                </div>

                <div className="mt-12 flex justify-center">
                  <div className="flex items-center gap-3 px-4 py-2 bg-[#F9F8F6] rounded-full cursor-pointer hover:bg-[#F0EFEB] transition-colors group"
                    onClick={copyId}>
                    <span className="text-xs text-[#A8A49D]">索引:</span>
                    <span className="text-xs text-[#8A8681] font-mono group-hover:text-[#3A3836] transition-colors">{selected.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full transition-colors ${copied ? 'bg-[#D97757] text-white' : 'bg-white border border-[#E8E6E1] text-[#A8A49D]'}`}>
                      {copied ? '✓ 已复制' : '复制'}
                    </span>
                  </div>
                </div>
                
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

