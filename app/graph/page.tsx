'use client'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'

interface GraphBucket {
  id: string
  name: string
  type: string
  importance: number
  pinned: boolean
  wish?: boolean
  todo?: string
  todo_done?: boolean
  related?: string[]
  content_preview: string
}

interface Pos { x: number; y: number }

const STORAGE_POS_KEY = 'ob-graph-positions'
const STORAGE_INCLUDED_KEY = 'ob-graph-included'
const NODE_R = 32

export default function GraphPage() {
  const [allBuckets, setAllBuckets] = useState<GraphBucket[]>([])
  const [nodes, setNodes] = useState<GraphBucket[]>([])
  const [positions, setPositions] = useState<Record<string, Pos>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragNodeId, setDragNodeId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<Pos>({ x: 0, y: 0 })
  // 拖拽/连线过程中频繁变化，用 ref 兜底取最新值，避免闭包里拿到旧值
  const nodesRef = useRef<GraphBucket[]>([])
  const positionsRef = useRef<Record<string, Pos>>({})
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { positionsRef.current = positions }, [positions])

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/buckets')
        const list: GraphBucket[] = await res.json()
        if (!res.ok) throw new Error((list as unknown as { error?: string })?.error ?? '读取失败')
        setAllBuckets(list)

        let included: string[] | null = null
        try {
          const raw = localStorage.getItem(STORAGE_INCLUDED_KEY)
          if (raw) included = JSON.parse(raw)
        } catch {}
        if (!included) {
          included = list
            .filter(b => b.wish || b.todo || b.pinned || (b.related && b.related.length > 0))
            .map(b => b.id)
        }
        const includedSet = new Set(included)
        const initialNodes = list.filter(b => includedSet.has(b.id))
        setNodes(initialNodes)

        let savedPos: Record<string, Pos> = {}
        try {
          const raw = localStorage.getItem(STORAGE_POS_KEY)
          if (raw) savedPos = JSON.parse(raw)
        } catch {}
        const center = { x: 480, y: 300 }
        const radius = Math.min(280, 60 + initialNodes.length * 14)
        const next: Record<string, Pos> = { ...savedPos }
        initialNodes.forEach((n, i) => {
          if (!next[n.id]) {
            const angle = (i / Math.max(1, initialNodes.length)) * Math.PI * 2
            next[n.id] = {
              x: center.x + radius * Math.cos(angle),
              y: center.y + radius * Math.sin(angle),
            }
          }
        })
        setPositions(next)
      } catch (e) {
        console.error('图谱加载失败', e)
        setLoadError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const persistIncluded = useCallback((ids: string[]) => {
    try { localStorage.setItem(STORAGE_INCLUDED_KEY, JSON.stringify(ids)) } catch {}
  }, [])
  const persistPositions = useCallback((pos: Record<string, Pos>) => {
    try { localStorage.setItem(STORAGE_POS_KEY, JSON.stringify(pos)) } catch {}
  }, [])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    const inGraph = new Set(nodes.map(n => n.id))
    return allBuckets
      .filter(b => !inGraph.has(b.id) && b.name?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [search, allBuckets, nodes])

  const addNode = (b: GraphBucket) => {
    setNodes(prev => {
      const next = [...prev, b]
      persistIncluded(next.map(n => n.id))
      return next
    })
    setPositions(prev => {
      const c = containerRef.current
      const center = c ? { x: c.clientWidth / 2, y: c.clientHeight / 2 } : { x: 480, y: 300 }
      const jitter = () => (Math.random() - 0.5) * 140
      const next = { ...prev, [b.id]: { x: center.x + jitter(), y: center.y + jitter() } }
      persistPositions(next)
      return next
    })
    setSearch('')
  }

  const removeNode = (id: string) => {
    setNodes(prev => {
      const next = prev.filter(n => n.id !== id)
      persistIncluded(next.map(n => n.id))
      return next
    })
    if (selectedId === id) setSelectedId(null)
  }

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
    const na = nodes.find(n => n.id === a)
    return !!na?.related?.includes(b)
  }, [nodes])

  const toggleEdge = useCallback(async (a: string, b: string) => {
    const connected = isConnected(a, b)
    const nodeA = nodesRef.current.find(n => n.id === a)
    const nodeB = nodesRef.current.find(n => n.id === b)
    const relatedA = connected ? (nodeA?.related ?? []).filter(x => x !== b) : Array.from(new Set([...(nodeA?.related ?? []), b]))
    const relatedB = connected ? (nodeB?.related ?? []).filter(x => x !== a) : Array.from(new Set([...(nodeB?.related ?? []), a]))

    setNodes(prev => prev.map(n => {
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
  }, [isConnected])

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
      if (dragNodeId) {
        persistPositions(positionsRef.current)
        setDragNodeId(null)
      }
      if (connecting) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const dropX = e.clientX - rect.left
          const dropY = e.clientY - rect.top
          let target: string | null = null
          for (const n of nodesRef.current) {
            const p = positionsRef.current[n.id]
            if (!p || n.id === connecting.from) continue
            if (Math.hypot(p.x - dropX, p.y - dropY) < NODE_R) { target = n.id; break }
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
  }, [dragNodeId, connecting, persistPositions, toggleEdge])

  const edgeList = useMemo(() => {
    const seen = new Set<string>()
    const list: [string, string][] = []
    for (const n of nodes) {
      for (const rid of n.related ?? []) {
        if (!positions[rid]) continue
        const key = [n.id, rid].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        list.push([n.id, rid])
      }
    }
    return list
  }, [nodes, positions])

  const selected = nodes.find(n => n.id === selectedId) ?? null

  if (loading) return <div className="flex items-center justify-center h-screen bg-[#FCFAF8] text-[#8A8681]">读取中...</div>
  if (loadError) return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#FCFAF8] text-[#C64B45] gap-3 px-4 text-center">
      <span>图谱加载失败：{loadError}</span>
      <Link href="/" className="text-sm text-[#D97757] underline">返回首页</Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans pb-20">
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[#8A8681]">
          <Link href="/" className="text-[#3A3836] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-[#D97757] to-[#E8A58F]"></div>
            <span className="text-xs sm:text-sm">Ombre Brain</span>
          </Link>
          <Link href="/?tab=timeline" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">时间线</Link>
          <Link href="/?tab=grid" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">记忆格</Link>
          <Link href="/?tab=review" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">审阅</Link>
          <Link href="/breath-sim" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">模拟 Breath</Link>
          <span className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[#3A3836] border-b-2 border-[#D97757]">关系图谱</span>
          <Link href="/journal" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">日记</Link>
          <Link href="/prompts" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">权重配置</Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索桶名加入图谱…"
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#D97757] bg-white"
            />
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-[#E8E6E1] rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                {searchResults.map(b => (
                  <div key={b.id} onClick={() => addNode(b)} className="px-3 py-2 text-sm hover:bg-[#F9F8F6] cursor-pointer truncate">
                    {b.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-[#8A8681] whitespace-nowrap">
            {nodes.length} 个节点 · 拖动节点右下角圆点连到另一个节点 · {saving ? '保存中…' : '改动自动保存'}
          </span>
        </div>

        <div
          ref={containerRef}
          className="relative w-full h-[640px] bg-white border border-[#E8E6E1] rounded-2xl overflow-hidden select-none"
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
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[#A8A49D]">
              图谱是空的，搜索桶名把它们加进来
            </div>
          )}

          {nodes.map(n => {
            const pos = positions[n.id]
            if (!pos) return null
            return (
              <div
                key={n.id}
                onMouseDown={e => onNodeMouseDown(e, n.id)}
                onClick={e => { e.stopPropagation(); setSelectedId(n.id) }}
                style={{ left: pos.x, top: pos.y }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing ${selectedId === n.id ? 'z-10' : ''}`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-center px-1.5 text-[10px] leading-tight font-medium shadow-sm border-2 transition-colors ${
                  selectedId === n.id ? 'border-[#D97757] bg-[#FDF0ED] text-[#B65D40]' : 'border-[#E8E6E1] bg-white text-[#3A3836]'
                }`}>
                  {n.name?.length > 10 ? n.name.slice(0, 9) + '…' : n.name}
                </div>
                <div
                  onMouseDown={e => onHandleMouseDown(e, n.id)}
                  title="拖到另一个节点上连线"
                  className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#D97757] border-2 border-white cursor-crosshair hover:scale-110 transition-transform"
                />
              </div>
            )
          })}
        </div>

        {selected && (
          <div className="mt-4 bg-white border border-[#E8E6E1] rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-[#3A3836] mb-1">{selected.name}</div>
              <p className="text-sm text-[#6C6965] line-clamp-2">{selected.content_preview}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <Link href={`/bucket/${selected.id}`} className="text-xs text-[#D97757] font-medium hover:text-[#B65D40] whitespace-nowrap">查看详情</Link>
              <button onClick={() => removeNode(selected.id)} className="text-xs text-[#8A8681] hover:text-[#C64B45] whitespace-nowrap">移出图谱</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
