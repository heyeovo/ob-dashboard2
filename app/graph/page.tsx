'use client'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'

interface GraphBucket {
  id: string
  name: string
  type: string
  importance: number
  score?: number
  pinned: boolean
  wish?: boolean
  todo?: string
  todo_done?: boolean
  related?: string[]
  content_preview: string
  created?: string
}

interface Pos { x: number; y: number }

const STORAGE_INCLUDED_KEY = 'ob-graph-included'
const TYPE_LABEL: Record<string, string> = { dynamic: '动态', permanent: '永久', feel: 'feel' }
const TYPES: ('dynamic' | 'permanent' | 'feel')[] = ['dynamic', 'permanent', 'feel']

function radiusFor(importance: number) {
  const imp = Math.min(10, Math.max(1, importance || 5))
  return 22 + (imp / 10) * 26
}

// 简单的力导向布局：节点互斥 + 连线弹力(让有关联的节点自然聚到一起) + 中心引力
function computeForceLayout(
  nodeIds: string[],
  edges: [string, string][],
  width: number,
  height: number,
): Record<string, Pos> {
  const n = nodeIds.length
  if (n === 0) return {}
  const pos: Record<string, Pos> = {}
  const vel: Record<string, Pos> = {}
  nodeIds.forEach((id, i) => {
    const angle = (i / n) * Math.PI * 2
    const r = Math.min(width, height) * 0.32
    pos[id] = {
      x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 20,
    }
    vel[id] = { x: 0, y: 0 }
  })
  const idxOf = new Map(nodeIds.map((id, i) => [id, i]))
  const edgeIdx = edges
    .filter(([a, b]) => idxOf.has(a) && idxOf.has(b) && a !== b)
    .map(([a, b]) => [idxOf.get(a)!, idxOf.get(b)!] as [number, number])

  const REPULSION = 2200
  const SPRING = 0.018
  const SPRING_LEN = 120
  const CENTER_PULL = 0.012
  const DAMPING = 0.82
  const ITER = 220

  for (let iter = 0; iter < ITER; iter++) {
    const force: Pos[] = nodeIds.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[nodeIds[i]], b = pos[nodeIds[j]]
        const dx = a.x - b.x, dy = a.y - b.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) distSq = 1
        const dist = Math.sqrt(distSq)
        const f = REPULSION / distSq
        const fx = (dx / dist) * f, fy = (dy / dist) * f
        force[i].x += fx; force[i].y += fy
        force[j].x -= fx; force[j].y -= fy
      }
    }
    for (const [i, j] of edgeIdx) {
      const a = pos[nodeIds[i]], b = pos[nodeIds[j]]
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.max(1, Math.hypot(dx, dy))
      const f = SPRING * (dist - SPRING_LEN)
      const fx = (dx / dist) * f, fy = (dy / dist) * f
      force[i].x += fx; force[i].y += fy
      force[j].x -= fx; force[j].y -= fy
    }
    for (let i = 0; i < n; i++) {
      const p = pos[nodeIds[i]]
      force[i].x += (width / 2 - p.x) * CENTER_PULL
      force[i].y += (height / 2 - p.y) * CENTER_PULL
    }
    for (let i = 0; i < n; i++) {
      const id = nodeIds[i]
      vel[id].x = (vel[id].x + force[i].x) * DAMPING
      vel[id].y = (vel[id].y + force[i].y) * DAMPING
      pos[id].x += vel[id].x
      pos[id].y += vel[id].y
    }
  }
  return pos
}

export default function GraphPage() {
  const [allBuckets, setAllBuckets] = useState<GraphBucket[]>([])
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set())
  const [positions, setPositions] = useState<Record<string, Pos>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragNodeId, setDragNodeId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)

  // 左侧列表筛选/排序
  const [listSearch, setListSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'dynamic' | 'permanent' | 'feel'>('all')
  const [sortBy, setSortBy] = useState<'score' | 'importance' | 'created'>('importance')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // 右侧面板：添加关联记忆的小搜索
  const [addRelSearch, setAddRelSearch] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<Pos>({ x: 0, y: 0 })
  const nodesRef = useRef<GraphBucket[]>([])
  const positionsRef = useRef<Record<string, Pos>>({})

  const nodes = useMemo(
    () => allBuckets.filter(b => includedIds.has(b.id)),
    [allBuckets, includedIds]
  )
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { positionsRef.current = positions }, [positions])

  // ---- 加载数据 ----
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/buckets')
        const list: GraphBucket[] = await res.json()
        if (!res.ok) throw new Error((list as unknown as { error?: string })?.error ?? '读取失败')
        setAllBuckets(list)

        let saved: string[] | null = null
        try {
          const raw = localStorage.getItem(STORAGE_INCLUDED_KEY)
          if (raw) saved = JSON.parse(raw)
        } catch {}
        const defaultIds = list.filter(b => (b.related?.length ?? 0) > 0).map(b => b.id)
        setIncludedIds(new Set(saved ?? defaultIds))
      } catch (e) {
        console.error('图谱加载失败', e)
        setLoadError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const persistIncluded = useCallback((ids: Set<string>) => {
    try { localStorage.setItem(STORAGE_INCLUDED_KEY, JSON.stringify(Array.from(ids))) } catch {}
  }, [])

  // 当前图谱的连线(去重)
  const edgeList = useMemo(() => {
    const seen = new Set<string>()
    const list: [string, string][] = []
    for (const n of nodes) {
      for (const rid of n.related ?? []) {
        if (!includedIds.has(rid)) continue
        const key = [n.id, rid].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        list.push([n.id, rid])
      }
    }
    return list
  }, [nodes, includedIds])

  // ---- 节点集合/连线变化时重新跑自动布局 ----
  const nodeIdsKey = useMemo(() => nodes.map(n => n.id).sort().join(','), [nodes])
  const edgeKey = useMemo(() => edgeList.map(e => e.join('-')).sort().join(','), [edgeList])
  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    const width = rect?.width || 900
    const height = rect?.height || 600
    const next = nodes.length === 0 ? {} : computeForceLayout(nodes.map(n => n.id), edgeList, width, height)
    setPositions(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey, edgeKey])

  const toggleNodeInGraph = (id: string) => {
    setIncludedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistIncluded(next)
      return next
    })
  }

  // ---- 拖动节点本体(当前浏览临时调整，不持久化) ----
  const onNodeMouseDown = (e: ReactMouseEvent<HTMLDivElement>, id: string) => {
    e.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    const pos = positions[id]
    if (!rect || !pos) return
    dragOffset.current = { x: e.clientX - rect.left - pos.x, y: e.clientY - rect.top - pos.y }
    setDragNodeId(id)
    setSelectedId(id)
  }

  const onHandleMouseDown = (e: ReactMouseEvent<HTMLDivElement>, id: string) => {
    e.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setConnecting({ from: id, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const isConnected = useCallback((a: string, b: string) => {
    const na = nodesRef.current.find(n => n.id === a) ?? allBuckets.find(n => n.id === a)
    return !!na?.related?.includes(b)
  }, [allBuckets])

  const toggleEdge = useCallback(async (a: string, b: string) => {
    const connected = isConnected(a, b)
    const nodeA = allBuckets.find(n => n.id === a)
    const nodeB = allBuckets.find(n => n.id === b)
    const relatedA = connected ? (nodeA?.related ?? []).filter(x => x !== b) : Array.from(new Set([...(nodeA?.related ?? []), b]))
    const relatedB = connected ? (nodeB?.related ?? []).filter(x => x !== a) : Array.from(new Set([...(nodeB?.related ?? []), a]))

    setAllBuckets(prev => prev.map(n => {
      if (n.id === a) return { ...n, related: relatedA }
      if (n.id === b) return { ...n, related: relatedB }
      return n
    }))

    setSaving(true)
    try {
      await Promise.all([
        fetch('/api/edit-bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a, related: relatedA }) }),
        fetch('/api/edit-bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b, related: relatedB }) }),
      ])
    } catch (e) {
      console.error('连线保存失败', e)
    } finally {
      setSaving(false)
    }
  }, [allBuckets, isConnected])

  // 从右侧"添加关联记忆"搜索里选中一个桶：若不在图谱里先加进去，再建立连线
  const addRelation = (targetId: string) => {
    if (!selectedId || targetId === selectedId) return
    if (!includedIds.has(targetId)) {
      setIncludedIds(prev => {
        const next = new Set(prev); next.add(targetId); persistIncluded(next); return next
      })
    }
    toggleEdge(selectedId, targetId)
    setAddRelSearch('')
  }

  useEffect(() => {
    if (!dragNodeId && !connecting) return

    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (dragNodeId) {
        const x = e.clientX - rect.left - dragOffset.current.x
        const y = e.clientY - rect.top - dragOffset.current.y
        setPositions(prev => ({ ...prev, [dragNodeId]: { x, y } }))
      }
      if (connecting) {
        setConnecting(prev => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null)
      }
    }

    const onUp = (e: MouseEvent) => {
      if (dragNodeId) setDragNodeId(null)
      if (connecting) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const dropX = e.clientX - rect.left
          const dropY = e.clientY - rect.top
          let target: string | null = null
          for (const n of nodesRef.current) {
            const p = positionsRef.current[n.id]
            if (!p || n.id === connecting.from) continue
            if (Math.hypot(p.x - dropX, p.y - dropY) < radiusFor(n.importance)) { target = n.id; break }
          }
          if (target) toggleEdge(connecting.from, target)
        }
        setConnecting(null)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragNodeId, connecting, toggleEdge])

  // ---- 左侧历史列表 ----
  const listItems = useMemo(() => {
    let arr = allBuckets.filter(b => b.type !== 'archived')
    if (typeFilter !== 'all') arr = arr.filter(b => b.type === typeFilter)
    if (listSearch.trim()) {
      const q = listSearch.trim().toLowerCase()
      arr = arr.filter(b => b.name?.toLowerCase().includes(q) || b.content_preview?.toLowerCase().includes(q))
    }
    const dir = sortOrder === 'desc' ? -1 : 1
    arr = [...arr].sort((a, b) => {
      if (sortBy === 'created') return dir * (new Date(a.created ?? 0).getTime() - new Date(b.created ?? 0).getTime())
      if (sortBy === 'importance') return dir * ((a.importance ?? 0) - (b.importance ?? 0))
      return dir * ((a.score ?? 0) - (b.score ?? 0))
    })
    return arr
  }, [allBuckets, typeFilter, listSearch, sortBy, sortOrder])

  const selected = allBuckets.find(n => n.id === selectedId) ?? null
  const selectedInGraph = !!(selectedId && includedIds.has(selectedId))

  const addRelResults = useMemo(() => {
    if (!addRelSearch.trim() || !selected) return []
    const q = addRelSearch.trim().toLowerCase()
    const already = new Set(selected.related ?? [])
    return allBuckets
      .filter(b => b.id !== selected.id && !already.has(b.id) && b.name?.toLowerCase().includes(q))
      .slice(0, 6)
  }, [addRelSearch, selected, allBuckets])

  if (loading) return <div className="flex items-center justify-center h-screen bg-[#FCFAF8] text-[#8A8681]">读取中...</div>
  if (loadError) return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#FCFAF8] text-[#C64B45] gap-3 px-4 text-center">
      <span>图谱加载失败：{loadError}</span>
      <Link href="/" className="text-sm text-[#D97757] underline">返回首页</Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans pb-10">
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[#8A8681] overflow-x-auto">
          <Link href="/" className="text-[#3A3836] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4 flex-shrink-0">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-[#D97757] to-[#E8A58F]"></div>
            <span className="text-xs sm:text-sm">Ombre Brain</span>
          </Link>
          <Link href="/?tab=timeline" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">时间线</Link>
          <Link href="/?tab=grid" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">记忆格</Link>
          <Link href="/?tab=review" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">审阅</Link>
          <Link href="/breath-sim" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">模拟 Breath</Link>
          <span className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[#3A3836] border-b-2 border-[#D97757] flex-shrink-0">关系图谱</span>
          <Link href="/journal" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">日记</Link>
          <Link href="/prompts" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">权重配置</Link>
        </div>
      </nav>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#8A8681]">
            {nodes.length} 个节点 · {edgeList.length} 条连线 · 拖动节点右下角圆点连到另一个节点 · {saving ? '保存中…' : '改动自动保存'}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 items-stretch">
          {/* 左侧：筛选 + 历史列表 */}
          <div className="w-full lg:w-72 flex-shrink-0 bg-white border border-[#E8E6E1] rounded-2xl p-3 flex flex-col h-[420px] lg:h-[680px]">
            <input
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              placeholder="搜索桶名或内容…"
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-1.5 mb-2 outline-none focus:border-[#D97757]"
            />
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {(['all', ...TYPES] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    typeFilter === t ? 'bg-[#3A3836] border-[#3A3836] text-white' : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                  }`}>
                  {t === 'all' ? '全部' : TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mb-3">
              <select value={sortBy} onChange={e => setSortBy(e.target.value as 'score' | 'importance' | 'created')}
                className="text-xs px-2 py-1.5 rounded-md border border-[#E8E6E1] bg-white text-[#6C6965] outline-none cursor-pointer flex-1">
                <option value="score">权重</option>
                <option value="importance">重要度</option>
                <option value="created">时间</option>
              </select>
              <button onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
                className={`text-xs px-2.5 py-1.5 rounded-md border flex-shrink-0 ${sortOrder === 'desc' ? 'bg-[#D97757] text-white border-[#D97757]' : 'bg-white border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'}`}>
                {sortOrder === 'desc' ? '↓' : '↑'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 -mr-1 pr-1">
              {listItems.map(b => {
                const inGraph = includedIds.has(b.id)
                const isSel = selectedId === b.id
                return (
                  <div key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`rounded-lg px-2.5 py-2 cursor-pointer border transition-colors ${
                      isSel ? 'bg-[#FDF0ED] border-[#D97757]' : 'bg-[#FCFAF8] border-transparent hover:bg-[#F4F2EC]'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#3A3836] truncate">{b.name}</span>
                      {!inGraph && (
                        <button onClick={(e) => { e.stopPropagation(); toggleNodeInGraph(b.id) }}
                          className="text-[10px] text-[#D97757] flex-shrink-0 hover:underline whitespace-nowrap">
                          加入图谱
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-[#A8A49D] truncate mt-0.5">{b.content_preview}</p>
                  </div>
                )
              })}
              {listItems.length === 0 && (
                <div className="text-xs text-[#A8A49D] text-center py-6">没有匹配的桶</div>
              )}
            </div>
          </div>

          {/* 中间：图谱 */}
          <div
            ref={containerRef}
            className="relative flex-1 bg-white border border-[#E8E6E1] rounded-2xl overflow-hidden select-none h-[420px] lg:h-[680px]"
            onClick={() => setSelectedId(null)}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {edgeList.map(([a, b]) => {
                const pa = positions[a]; const pb = positions[b]
                if (!pa || !pb) return null
                return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#D97757" strokeWidth={1.5} strokeOpacity={0.4} />
              })}
              {connecting && positions[connecting.from] && (
                <line
                  x1={positions[connecting.from].x} y1={positions[connecting.from].y}
                  x2={connecting.x} y2={connecting.y}
                  stroke="#D97757" strokeWidth={1.5} strokeDasharray="4 3"
                />
              )}
            </svg>

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[#A8A49D] text-center px-6">
                图谱是空的，从左边列表里把桶“加入图谱”
              </div>
            )}

            {nodes.map(n => {
              const pos = positions[n.id]
              if (!pos) return null
              const r = radiusFor(n.importance)
              const isSel = selectedId === n.id
              return (
                <div
                  key={n.id}
                  onMouseDown={e => onNodeMouseDown(e, n.id)}
                  onClick={e => { e.stopPropagation(); setSelectedId(n.id) }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-grab active:cursor-grabbing rounded-full text-center px-1.5 leading-tight font-medium shadow-sm border-2 transition-colors ${
                    isSel
                      ? 'border-[#D97757] bg-[#FDF0ED] text-[#B65D40] ring-4 ring-[#D97757]/20 z-10'
                      : n.pinned ? 'border-[#E8A23A] bg-[#FFFBF0] text-[#8A6A1F]' : 'border-[#E8E6E1] bg-white text-[#3A3836]'
                  }`}
                  style={{ left: pos.x, top: pos.y, width: r * 2, height: r * 2, fontSize: r > 32 ? 11 : 10 }}
                >
                  {n.name?.length > 12 ? n.name.slice(0, 11) + '…' : n.name}
                  <div
                    onMouseDown={e => onHandleMouseDown(e, n.id)}
                    title="拖到另一个节点上连线"
                    className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#D97757] border-2 border-white cursor-crosshair hover:scale-110 transition-transform"
                  />
                </div>
              )
            })}
          </div>

          {/* 右侧：详情面板 */}
          <div className="w-full lg:w-80 flex-shrink-0 bg-white border border-[#E8E6E1] rounded-2xl p-4 h-[420px] lg:h-[680px] overflow-y-auto">
            {!selected ? (
              <div className="text-sm text-[#A8A49D] text-center py-10">点一个桶查看详情</div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-semibold text-[#3A3836]">{selected.name}</span>
                  {selected.pinned && <span className="text-xs text-[#B8860B]">★钉选</span>}
                  {selected.wish && <span className="text-xs text-[#B8860B]">✦悬念</span>}
                </div>
                <div className="text-[11px] text-[#A8A49D] mb-3">
                  {TYPE_LABEL[selected.type] ?? selected.type} · 重要度 {selected.importance}
                  {!selectedInGraph && <span className="ml-2 text-[#D97757]">未在图谱中</span>}
                </div>
                <p className="text-sm text-[#6C6965] leading-relaxed mb-4 whitespace-pre-wrap">{selected.content_preview}</p>

                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <Link href={`/bucket/${selected.id}`} className="text-xs text-[#D97757] font-medium hover:text-[#B65D40]">查看详情</Link>
                  {selectedInGraph ? (
                    <button onClick={() => toggleNodeInGraph(selected.id)} className="text-xs text-[#8A8681] hover:text-[#C64B45]">移出图谱</button>
                  ) : (
                    <button onClick={() => toggleNodeInGraph(selected.id)} className="text-xs text-[#D97757] hover:underline">加入图谱</button>
                  )}
                </div>

                <div className="border-t border-[#F0EFEB] pt-3">
                  <div className="text-xs font-medium text-[#3A3836] mb-2">关联记忆 · {selected.related?.length ?? 0}</div>
                  <div className="space-y-1.5 mb-3">
                    {(selected.related ?? []).map(rid => {
                      const rb = allBuckets.find(b => b.id === rid)
                      if (!rb) return null
                      const rInGraph = includedIds.has(rid)
                      return (
                        <div key={rid} className="bg-[#FCFAF8] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0 cursor-pointer" onClick={() => setSelectedId(rid)}>
                            <div className="text-xs font-medium text-[#3A3836] truncate">{rb.name}</div>
                            <div className="text-[11px] text-[#A8A49D] truncate">{rb.content_preview}</div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {!rInGraph && (
                              <button onClick={() => toggleNodeInGraph(rid)} className="text-[10px] text-[#D97757] hover:underline whitespace-nowrap">加入</button>
                            )}
                            <button onClick={() => toggleEdge(selected.id, rid)} className="text-[10px] text-[#A8A49D] hover:text-[#C64B45]">✕</button>
                          </div>
                        </div>
                      )
                    })}
                    {(selected.related ?? []).length === 0 && (
                      <div className="text-xs text-[#A8A49D]">还没有关联记忆</div>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      value={addRelSearch}
                      onChange={e => setAddRelSearch(e.target.value)}
                      placeholder="+ 添加关联记忆…"
                      className="w-full text-xs border border-[#E8E6E1] rounded-lg px-3 py-1.5 outline-none focus:border-[#D97757]"
                    />
                    {addRelResults.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full bg-white border border-[#E8E6E1] rounded-lg shadow-lg overflow-hidden">
                        {addRelResults.map(b => (
                          <div key={b.id} onClick={() => addRelation(b.id)} className="px-3 py-2 text-xs hover:bg-[#F9F8F6] cursor-pointer truncate">
                            {b.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
