'use client'

export const dynamic = 'force-dynamic'
import { Suspense, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import BucketDetailDrawer from '../components/BucketDetailDrawer'
import MemoryViewSwitch from '../components/MemoryViewSwitch'
import DetailPanel from '../components/DetailPanel'
import KnobRow from '../components/KnobRow'
import type { Bucket, BucketDetail, QuickFilter, DatePreset } from './memoryTypes'
import { DATE_PRESETS, isFeel, isJourney, matchesQuickFilter, matchesDateFilter, getTopTags, groupByMonth } from './memoryFilters'
import { SkeletonCard } from './MemoryCard'
import MemoryGrid from './MemoryGrid'
import MemoryTimeline from './MemoryTimeline'
import MemoryFilters from './MemorySearchFilters'

function HomeClient() {
 
  const searchParams = useSearchParams()

  // 从 URL 直接读取 tab，默认 timeline
  const activeTab = searchParams.get('tab') === 'grid' ? 'grid' : 'timeline'
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
  const openedQueryBucket = useRef('')
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ title: '', content: '', tags: '', importance: 5, valence: 0.5, arousal: 0.3 })
  const [adding, setAdding] = useState(false)
  const [gridViewMode, setGridViewMode] = useState<'list' | 'card'>('list')
  const [sortBy, setSortBy] = useState<'score' | 'importance' | 'created'>('score')
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [categories, setCategories] = useState<string[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  const fetchBuckets = useCallback((signal?: AbortSignal) => {
    return fetch(`/api/buckets?full=1&_t=${Date.now()}`, { signal })
      .then(r => r.json())
      .then(data => {
        const all = (Array.isArray(data) ? data : (data.buckets || [])).filter((bucket: Bucket) => !isJourney(bucket))
        setBuckets(all)
        try { sessionStorage.setItem('ombra_buckets', JSON.stringify(all)) } catch {}
      })
  }, [])

  // 首次加载：sessionStorage 恢复 + 后台拉取全部数据
  useEffect(() => {
    const ac = new AbortController()
    try {
      const cached = sessionStorage.getItem('ombra_buckets')
      if (cached) {
        const arr = JSON.parse(cached)
        if (Array.isArray(arr) && arr.length > 0) {
          setBuckets(arr.filter((bucket: Bucket) => !isJourney(bucket)))
          setLoading(false)
        }
      }
    } catch {}
    fetchBuckets(ac.signal).then(() => setLoading(false)).catch((e) => {
      if (e?.name !== 'AbortError') setLoading(false)
    })
    return () => ac.abort()
  }, [fetchBuckets])

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
      // Exact ID match has highest priority
      if (b.id.toLowerCase() === qLower) return true
      const haystack = [
        b.id,
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

  useEffect(() => {
    const bucketId = searchParams.get('bucket') || ''
    if (!bucketId || bucketId === openedQueryBucket.current) return
    openedQueryBucket.current = bucketId
    void openBucket(bucketId)
  }, [searchParams])

  const traceOp = async (id: string, args: Record<string, unknown>) => {
    const previousSelected = selected
    // Optimistic update — instant UI feedback for metadata changes
    // 元数据乐观更新 — 立即反馈
    if (selected && selected.id === id) {
      const updates: any = {}
      const directFields = ['resolved', 'event_time', 'pinned', 'digested', 'wish', 'todo_done', 'todo']
      for (const f of directFields) {
        if (f in args) updates[f] = args[f]
      }
      if ('importance' in args) updates.importance = Number(args.importance)

      if (Object.keys(updates).length > 0) {
        setSelected(prev => prev ? {
          ...prev,
          metadata: { ...prev.metadata, ...updates },
          noise: 'resolved' in args
            ? (Boolean(args.resolved) && (args.importance != null ? Number(args.importance) : prev.metadata.importance) === 1)
            : prev.noise,
        } : prev)
      }
    }

    setOperating(true)
    try {
      const response = await fetch('/api/edit-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...args })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || `更新失败（HTTP ${response.status}）`)
      }
      if (args.delete) {
        detailCache.current.delete(id)
        setSelected(null)
        void fetchBuckets()
        return
      }
      if (!payload?.result?.bucket) {
        throw new Error(`更新失败（HTTP ${response.status}）`)
      }
      const detail = payload.result.bucket
      detailCache.current.set(id, detail)
      setSelected(detail)
      // Background: refresh full list (may be slow with many buckets, don't block UI)
      void fetchBuckets()
    } catch (error) {
      if (previousSelected?.id === id) setSelected(previousSelected)
      window.alert(error instanceof Error ? error.message : '更新失败，请重试')
    } finally {
      setOperating(false)
    }
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


  const restoreNoise = (id: string) => {
    // 乐观更新：立即从本地列表移除 noise 状态
    setBuckets(prev => prev.map(bucket => bucket.id === id ? { ...bucket, noise: false, resolved: false, importance: bucket.importance } : bucket))
    void traceOp(id, { resolved: false })
  }

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onSearchChange = (val: string) => {
    setSearch(val)
    clearTimeout(searchTimerRef.current)
    if (!val.trim()) {
      setSearchResults(null)   // 立即清空，不等 debounce
      return
    }
    searchTimerRef.current = setTimeout(() => {
      doSearch(val)
    }, 300)
  }

  const statusCounts = useMemo(() => {
    const list = searchResults ?? buckets
    return {
      all: list.length,
      pinned: list.filter(b => b.pinned && !isFeel(b)).length,
      important: list.filter(b => Number(b.importance) >= 7 && !b.pinned).length,
      feel: list.filter(b => isFeel(b)).length,
      digested: list.filter(b => !!b.digested).length,
      resolved: list.filter(b => b.resolved).length,
      archived: list.filter(b => b.type === 'archived').length,
      noise: list.filter(b => !!b.noise || (b.resolved && b.importance === 1)).length,
      other: list.filter(b => !b.pinned && Number(b.importance) < 7 && !b.resolved && !b.digested && !isFeel(b) && !(!!b.noise || (b.resolved && b.importance === 1))).length,
    }
  }, [searchResults, buckets])

  if (loading && buckets.length === 0) return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <main className="max-w-6xl mx-auto px-3 sm:px-6 pt-4 sm:pt-10 pb-20">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </main>
    </div>
  )

  return (
    <div className={`mobile-page-with-topbar min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans selection:bg-[var(--color-primary)] selection:text-[var(--color-on-primary)] pb-20`}>
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Mobile-only header。切换器保留时间线与记忆格。 */}
      <header className="mobile-page-topbar flex items-center justify-between px-3 md:hidden">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-gradient)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">记忆库</span>
        </div>
        <MemoryViewSwitch size="sm" />
      </header>

      {/* 桌面端：顶部横条撤了，切换器搬进页面 */}
      <div className="hidden md:block sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center">
          <MemoryViewSwitch />
        </div>
      </div>

      <main className={`max-w-6xl mx-auto px-3 sm:px-6 pt-4 sm:pt-10 `}>
        {(
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

        <>
            <MemoryFilters activeTab={activeTab} search={search} onSearchChange={onSearchChange} statusCounts={statusCounts} quickFilter={quickFilter} setQuickFilter={setQuickFilter} activeTag={activeTag} setActiveTag={setActiveTag} topTags={topTags} categories={categories} activeCategory={activeCategory} setActiveCategory={setActiveCategory} />

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
              <div className="flex items-center gap-2 bg-[var(--color-surface)]/40 rounded-lg px-3 py-1.5 border border-[var(--color-border)] shadow-sm">
                <span className="text-xs text-[var(--color-text-disabled)] hidden sm:inline">时间</span>
                <select
                  className="text-xs bg-transparent outline-none text-[var(--color-text-secondary)] cursor-pointer"
                  value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}>
                  {DATE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                {datePreset === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                      className="bg-[var(--color-surface)] rounded px-1.5 py-0.5 text-xs border border-[var(--color-border)]" />
                    <span className="text-[var(--color-text-disabled)]">-</span>
                    <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                      className="bg-[var(--color-surface)] rounded px-1.5 py-0.5 text-xs border border-[var(--color-border)]" />
                  </div>
                )}
              </div>

              {/* 记忆格视图特有控件 */}
              {activeTab === 'grid' && (
                <>
                  <button onClick={() => setGridViewMode(gridViewMode === 'list' ? 'card' : 'list')}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"
                  >{gridViewMode === 'list' ? '⧉' : '☰'}</button>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/60 text-[var(--color-text-secondary)] outline-none cursor-pointer">
                    <option value="score">权重</option>
                    <option value="importance">重要度</option>
                    <option value="created">时间</option>
                  </select>
                  <button onClick={() => setSortOrder(order => order === 'desc' ? 'asc' : 'desc')}
                    className={`text-xs px-2.5 py-1.5 rounded-md border ${sortOrder === 'desc' ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'bg-[var(--color-surface)]/60 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}`}
                  >{sortOrder === 'desc' ? '↓降序' : '↑升序'}</button>
                </>
              )}
            </div>

            {/* 时间线 - 渲染区域 */}
            {activeTab === 'timeline' ? (
              <MemoryTimeline monthlyGroups={monthlyGroups} collapsedMonths={collapsedMonths} collapsedDates={collapsedDates} toggleMonthCollapse={toggleMonthCollapse} toggleDateCollapse={toggleDateCollapse} onOpen={openBucket} onRestoreNoise={restoreNoise} />
            ) : (
              <MemoryGrid displayed={displayed} quickFilter={quickFilter} sortBy={sortBy} sortOrder={sortOrder} gridViewMode={gridViewMode} onOpen={openBucket} onRestoreNoise={restoreNoise} />
            )}
            {displayed.length === 0 && !loading && (
              <div className="text-center text-[var(--color-text-disabled)] py-20 text-sm bg-[var(--color-surface)] rounded-2xl border border-dashed border-[var(--color-border)]">
                没有找到对应的记录
              </div>
            )}

            {/* 首次加载骨架卡片 */}
            {loading && buckets.length === 0 && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {!loading && buckets.length > 0 && (
              <div className="text-center text-[var(--color-text-disabled)] py-8 text-xs">
                已加载全部 {buckets.length} 条记录
              </div>
            )}
          </>
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
          // Refresh drawer immediately to show updated activation_count
          const detail = await fetch(`/api/bucket/${id}`).then(r => r.json())
          detailCache.current.set(id, detail)
          setSelected(detail)
          fetchBuckets()
        }}
        onArchive={async (id) => {
          // 从当前 drawer 状态判断 — 比从 selected 闭包更可靠
          const isArchived = (selected?.metadata?.type || (selected as any)?.type) === 'archived'
          const endpoint = isArchived ? `/api/unarchive/${id}` : `/api/archive/${id}`
          setOperating(true)
          try {
            const res = await fetch(endpoint, { method: 'POST' })
            const data = await res.json()
            console.log('archive/unarchive response:', endpoint, data)
            if (data.ok) {
              detailCache.current.delete(id)
              const detail = await fetch(`/api/bucket/${id}`).then(r => r.json())
              console.log('re-fetched detail type:', detail?.metadata?.type)
              detailCache.current.set(id, detail)
              setSelected(detail)
              fetchBuckets()
            } else {
              console.error('Archive/unarchive failed:', data)
            }
          } catch (e) {
            console.error('Archive/unarchive error:', e)
          } finally {
            setOperating(false)
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
      {(
        <button onClick={() => setShowAdd(true)}
          className="fixed bottom-28 md:bottom-8 right-4 sm:right-8 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] text-xl sm:text-2xl shadow-lg hover:bg-[var(--color-primary-hover)] active:scale-90 transition-all flex items-center justify-center z-50">
          +
        </button>
      )}

      {/* 新增弹窗 */}
      <DetailPanel open={showAdd} onClose={() => setShowAdd(false)} mode="modal" width="max-w-2xl">
        <div className="flex flex-col" style={{ height: '65vh', maxHeight: '75vh' }}>
        <h3 className="text-[var(--color-text-primary)] font-semibold mb-4 flex-shrink-0">新增记忆</h3>
            <input placeholder="标题（可选）" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--color-primary)] flex-shrink-0" />
            <textarea placeholder="内容…" value={addForm.content} onChange={e => setAddForm(f => ({ ...f, content: e.target.value }))}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm mb-3 resize-none focus:outline-none focus:border-[var(--color-primary)] flex-1 min-h-0" />
            <input placeholder="标签（逗号分隔）" value={addForm.tags} onChange={e => setAddForm(f => ({ ...f, tags: e.target.value }))}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-[var(--color-primary)] flex-shrink-0" />
            <div className="grid grid-cols-3 gap-3 mb-4 flex-shrink-0">
              <KnobRow label="重要度" desc="1–10，越高越不易遗忘" value={addForm.importance} min={1} max={10} step={1} onChange={v => setAddForm(f => ({ ...f, importance: v }))} />
              <KnobRow label="效价 V" desc="0 负面 → 1 正面" value={addForm.valence} min={0} max={1} step={0.1} onChange={v => setAddForm(f => ({ ...f, valence: v }))} />
              <KnobRow label="唤醒 A" desc="0 平静 → 1 激动" value={addForm.arousal} min={0} max={1} step={0.1} onChange={v => setAddForm(f => ({ ...f, arousal: v }))} />
            </div>
            <div className="flex items-end justify-end flex-shrink-0">
              <div className="flex gap-2">
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
                    setAddForm({ title: '', content: '', tags: '', importance: 5, valence: 0.5, arousal: 0.3 })
                    setSearchResults(null)
                    await fetchBuckets()
                  }}
                  className="px-4 py-2 text-sm bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-lg disabled:opacity-40 hover:bg-[var(--color-primary-hover)] transition-colors">
                  {adding ? '存入中…' : '存入记忆'}
                </button>
              </div>
            </div>
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
