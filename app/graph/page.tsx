'use client'
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import BucketDetailDrawer from '../components/BucketDetailDrawer'

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
    wish?: boolean
    todo?: string
    todo_done?: boolean
    related?: string[]
  }
}

const STORAGE_INCLUDED_KEY = 'ob-graph-included'
const TYPE_LABEL: Record<string, string> = { dynamic: '动态', permanent: '永久', feel: 'feel' }
const TYPES: ('dynamic' | 'permanent' | 'feel')[] = ['dynamic', 'permanent', 'feel']

const TYPE_COLORS: Record<string, { fill: string; border: string; text: string }> = {
  dynamic: { fill: '#FFF5F0', border: '#D97757', text: '#B65D40' },
  permanent: { fill: '#FFFBF0', border: '#C49B3A', text: '#8A6A1F' },
  feel: { fill: '#F8F0FA', border: '#B795C9', text: '#8A6A9A' },
}

function radiusFor(importance: number) {
  const imp = Math.min(10, Math.max(1, importance || 5))
  return 22 + (imp / 10) * 26
}

// 提取公共边计算函数，供 load 和 useMemo 共用
function computeEdgeListForIds(
  all: { id: string; related?: string[] }[],
  included: Set<string>,
): [string, string][] {
  const seen = new Set<string>()
  const list: [string, string][] = []
  for (const n of all) {
    if (!included.has(n.id)) continue
    for (const rid of n.related ?? []) {
      if (!included.has(rid)) continue
      const key = [n.id, rid].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      list.push([n.id, rid])
    }
  }
  return list
}

// 快速字符串哈希（非加密，仅用于缓存指纹）
function simpleHash(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
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
  const ITER = 150 // 原来 220，减到 150 仍能收敛，减少 ~32% 计算量

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

  // BucketDetailDrawer 状态
  const [detailSelected, setDetailSelected] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)

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
  const computedKeyRef = useRef('') // 守卫：避免首次重复跑 force layout

  const nodes = useMemo(
    () => allBuckets.filter(b => includedIds.has(b.id)),
    [allBuckets, includedIds]
  )
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { positionsRef.current = positions }, [positions])

  // ---- 加载数据：缓存优先，无缓存则拉后端 + 算布局 + 写缓存 ----
  useEffect(() => {
    async function load() {
      try {
        // 先确定 includedIds（不管缓存命中与否都要这个逻辑）
        let saved: string[] | null = null
        try {
          const raw = localStorage.getItem(STORAGE_INCLUDED_KEY)
          if (raw) saved = JSON.parse(raw)
        } catch {}

        // ---- 尝试从缓存恢复 ----
        const fromCache = ((): boolean => {
          try {
            const dataRaw = sessionStorage.getItem('ob-graph-data')
            const posRaw = localStorage.getItem('ob-graph-pos')
            if (!dataRaw || !posRaw) return false

            const dataCache: { fingerprint: string; data: GraphBucket[] } = JSON.parse(dataRaw)
            const posCache: { fingerprint: string; positions: Record<string, Pos> } = JSON.parse(posRaw)

            const defaultIds = dataCache.data.filter(b => (b.related?.length ?? 0) > 0).map(b => b.id)
            const ids = new Set(saved ?? defaultIds)
            const includedFp = Array.from(ids).sort().join(',')

            if (posCache.fingerprint !== `${dataCache.fingerprint}|${includedFp}`) return false

            setAllBuckets(dataCache.data)
            setIncludedIds(ids)
            setPositions(posCache.positions)
            return true // cache hit
          } catch { return false }
        })()
        if (fromCache) { setLoading(false); return }

        // ---- 缓存未命中：真实加载 ----
        const res = await fetch('/api/buckets')
        const list: GraphBucket[] = await res.json()
        if (!res.ok) throw new Error((list as unknown as { error?: string })?.error ?? '读取失败')

        // 算数据指纹（节点 id + 关联关系的变化都会让指纹改变）
        const fingerprint = simpleHash(
          list.map(b => `${b.id}:${(b.related ?? []).sort().join(',')}`).sort().join('|')
        )

        const defaultIds = list.filter(b => (b.related?.length ?? 0) > 0).map(b => b.id)
        const ids = new Set(saved ?? defaultIds)

        // 此时 containerRef 已挂载（loading 态渲染了完整布局）
        const rect = containerRef.current?.getBoundingClientRect()
        const width = rect?.width || 900
        const height = rect?.height || 600

        const filtered = list.filter(b => ids.has(b.id))
        const edges = computeEdgeListForIds(list, ids)
        const newPositions =
          filtered.length === 0
            ? {}
            : computeForceLayout(
                filtered.map(n => n.id),
                edges,
                width,
                height,
              )

        // 写缓存
        try {
          sessionStorage.setItem('ob-graph-data', JSON.stringify({ fingerprint, data: list }))
          const includedFp = Array.from(ids).sort().join(',')
          localStorage.setItem('ob-graph-pos', JSON.stringify({
            fingerprint: `${fingerprint}|${includedFp}`,
            positions: newPositions,
          }))
        } catch {}

        // 一次性 setState，React 18 自动 batch
        setAllBuckets(list)
        setIncludedIds(ids)
        setPositions(newPositions)
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
  const edgeList = useMemo(
    () => computeEdgeListForIds(allBuckets, includedIds),
    [allBuckets, includedIds],
  )

  // ---- 节点集合/连线变化时重新跑自动布局 ----
  // computedKeyRef 守卫避免首次 mount 重复计算（数据加载时已算好）
  const nodeIdsKey = useMemo(() => nodes.map(n => n.id).sort().join(','), [nodes])
  const edgeKey = useMemo(() => edgeList.map(e => e.join('-')).sort().join(','), [edgeList])
  useEffect(() => {
    if (nodes.length === 0) return
    const key = nodeIdsKey + '|' + edgeKey
    if (computedKeyRef.current === key) return
    computedKeyRef.current = key

    const rect = containerRef.current?.getBoundingClientRect()
    const width = rect?.width || 900
    const height = rect?.height || 600
    const next = computeForceLayout(nodes.map(n => n.id), edgeList, width, height)
    setPositions(next)
    // 自动布局后同步更新缓存
    try {
      const dataRaw = sessionStorage.getItem('ob-graph-data')
      if (dataRaw) {
        const { fingerprint } = JSON.parse(dataRaw) as { fingerprint: string }
        const includedFp = Array.from(includedIds).sort().join(',')
        localStorage.setItem('ob-graph-pos', JSON.stringify({
          fingerprint: `${fingerprint}|${includedFp}`,
          positions: next,
        }))
      }
    } catch {}
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

  // ---- BucketDetailDrawer 操作函数 ----
  const openBucketDetail = async (id: string) => {
    setDetailLoading(true)
    setDetailSelected(null)
    setEditing(false)
    try {
      const data = await fetch(`/api/bucket/${id}`).then(r => r.json())
      setDetailSelected(data)
    } finally {
      setDetailLoading(false)
    }
  }

  const traceOp = async (id: string, args: Record<string, unknown>) => {
    setOperating(true)
    try {
      await fetch('/api/edit-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...args }),
      })
      const updated = await fetch(`/api/bucket/${id}`).then(r => r.json())
      setDetailSelected(updated)
    } finally {
      setOperating(false)
    }
  }

  const saveEdit = async () => {
    if (!detailSelected) return
    setSavingDetail(true)
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: detailSelected.id, content: editContent }),
    })
    setSavingDetail(false)
    setEditing(false)
    openBucketDetail(detailSelected.id)
  }

  const copyId = () => {
    if (!detailSelected) return
    navigator.clipboard.writeText(detailSelected.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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

  const selectedNode = allBuckets.find(n => n.id === selectedId) ?? null
  const selectedInGraph = !!(selectedId && includedIds.has(selectedId))

  const addRelResults = useMemo(() => {
    if (!addRelSearch.trim() || !selectedNode) return []
    const q = addRelSearch.trim().toLowerCase()
    const already = new Set(selectedNode.related ?? [])
    return allBuckets
      .filter(b => b.id !== selectedNode.id && !already.has(b.id) && b.name?.toLowerCase().includes(q))
      .slice(0, 6)
  }, [addRelSearch, selectedNode, allBuckets])

  // ============ 渲染 ============

  const NEUMORPHIC = `
    .graph-page {
      --bg: #FCFAF8;
      --bg-gradient: radial-gradient(ellipse at 30% 20%, #FCFAF8 0%, #F5F0E8 60%, #EDE4D3 100%);
      --surface: rgba(255, 255, 255, 0.45);
      --surface-solid: #F7F2E8;
      --border: rgba(200, 185, 165, 0.25);
      --border-strong: rgba(180, 160, 135, 0.45);
      --text: #3A3836;
      --text-dim: #8A8681;
      --text-light: #B0A590;
      --accent: #D97757;
      --accent-light: #E8A58F;
      --accent-glow: rgba(217, 119, 87, 0.15);
      --positive: #4A7C59;
      --negative: #8B4A4A;
      --shadow-light: rgba(255, 252, 248, 0.8);
      --shadow-dark: rgba(180, 160, 140, 0.30);
      --shadow-dark-subtle: rgba(180, 160, 140, 0.15);
      background: var(--bg-gradient);
      background-attachment: fixed;
      min-height: 100vh;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--text);
    }
    .neu-card { background: linear-gradient(145deg, #FAFAF6, #F0EDE4); border: 1px solid var(--border); border-radius: 20px; box-shadow: 6px 6px 14px var(--shadow-dark-subtle), -6px -6px 14px var(--shadow-light); }
    .neu-inset { background: var(--bg); border: 1px solid var(--border); border-radius: 20px; box-shadow: inset 4px 4px 10px var(--shadow-dark-subtle), inset -4px -4px 10px var(--shadow-light); }
    .neu-pill { background: linear-gradient(145deg, #FAF6ED, #EDE4D3); border: none; border-radius: 24px; box-shadow: 3px 3px 6px var(--shadow-dark-subtle), -3px -3px 6px var(--shadow-light); transition: all 0.2s cubic-bezier(0.4,0,0.2,1); color: var(--text-dim); cursor: pointer; font-family: inherit; }
    .neu-pill:hover { color: var(--accent); box-shadow: 4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light); transform: translateY(-1px); }
    .neu-pill:active { transform: translateY(0); box-shadow: inset 2px 2px 5px var(--shadow-dark-subtle), inset -2px -2px 5px var(--shadow-light); }
    .neu-pill.active { color: #F0EDE4; background: linear-gradient(145deg, var(--accent-light), var(--accent)); box-shadow: inset 3px 3px 6px rgba(0,0,0,0.2), inset -2px -2px 4px rgba(255,255,255,0.05); }
    .neu-input { background: rgba(255,255,255,0.55); border: 1px solid var(--border); border-radius: 12px; box-shadow: inset 2px 2px 4px var(--shadow-dark-subtle), inset -2px -2px 4px var(--shadow-light); transition: all 0.25s ease; font-family: inherit; color: var(--text); }
    .neu-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow), inset 2px 2px 4px var(--shadow-dark-subtle), inset -2px -2px 4px var(--shadow-light); }
    .neu-input::placeholder { color: var(--text-light); }
    .neu-select { background: rgba(255,255,255,0.55); border: 1px solid var(--border); border-radius: 12px; box-shadow: inset 2px 2px 4px var(--shadow-dark-subtle), inset -2px -2px 4px var(--shadow-light); color: var(--text-dim); font-family: inherit; cursor: pointer; transition: all 0.25s ease; }
    .neu-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow), inset 2px 2px 4px var(--shadow-dark-subtle); }
    .neu-btn-primary { background: linear-gradient(145deg, var(--accent-light), var(--accent)); color: #FEF8F5; border: none; border-radius: 24px; box-shadow: 4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light); transition: all 0.2s cubic-bezier(0.4,0,0.2,1); cursor: pointer; font-family: inherit; position: relative; overflow: hidden; }
    .neu-btn-primary:hover { box-shadow: 6px 6px 12px var(--shadow-dark), -6px -6px 12px var(--shadow-light); transform: translateY(-1px); }
    .neu-btn-primary:active { transform: translateY(0); box-shadow: inset 3px 3px 6px rgba(0,0,0,0.15), inset -2px -2px 4px rgba(255,255,255,0.05); }
    .list-item { border-radius: 14px; transition: all 0.2s ease; cursor: pointer; border: 1px solid transparent; }
    .list-item:hover { background: rgba(255,255,255,0.6); box-shadow: 3px 3px 8px var(--shadow-dark-subtle), -3px -3px 8px var(--shadow-light); border-color: var(--border); transform: translateY(-1px); }
    .list-item.active { background: rgba(255,255,255,0.8); border-color: var(--accent); box-shadow: 4px 4px 10px var(--shadow-dark-subtle), -4px -4px 10px var(--shadow-light); }
    .related-item { background: rgba(255,255,255,0.45); border-radius: 12px; transition: all 0.15s ease; border: 1px solid transparent; }
    .related-item:hover { background: rgba(255,255,255,0.7); border-color: var(--border); }
    .dropdown-results { background: rgba(255,255,255,0.85); backdrop-filter: blur(8px); border: 1px solid var(--border); border-radius: 12px; box-shadow: 6px 6px 16px var(--shadow-dark-subtle); overflow: hidden; }
    .custom-scroll::-webkit-scrollbar { width: 4px; }
    .custom-scroll::-webkit-scrollbar-track { background: transparent; }
    .custom-scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
    .glass-nav { background: rgba(253,252,248,0.7); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
    @keyframes neuPulse { 0%,100% { box-shadow: 0 0 0 0 var(--accent-glow); } 50% { box-shadow: 0 0 0 6px transparent; } }
    .graph-node-highlight { animation: neuPulse 1.5s ease-in-out infinite; }
  `

  return (
    <>
      <style>{NEUMORPHIC}</style>
      <div className="graph-page pb-10">
        <nav className="glass-nav sticky top-0 z-20">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[var(--text-dim)] overflow-x-auto">
            <Link href="/" className="text-[var(--text)] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4 flex-shrink-0">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-light))' }} />
              <span className="text-xs sm:text-sm">Ombre Brain</span>
            </Link>
            <Link href="/?tab=timeline" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[var(--text)]">时间线</Link>
            <Link href="/?tab=grid" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[var(--text)]">记忆格</Link>
            <Link href="/?tab=review" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[var(--text)]">审阅</Link>
            <Link href="/breath-sim" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[var(--text)]">模拟 Breath</Link>
            <span className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[var(--text)] border-b-2" style={{ borderBottomColor: 'var(--accent)' }}>关系图谱</span>
            <Link href="/journal" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[var(--text)]">日记</Link>
            <Link href="/prompts" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[var(--text)]">权重配置</Link>
          </div>
        </nav>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4">
          {loadError ? (
            /* ---- 错误状态（全宽展示） ---- */
            <div className="neu-card px-8 py-10 text-center max-w-lg mx-auto mt-12">
              <div className="text-[var(--negative)] text-sm mb-2">图谱加载失败：{loadError}</div>
              <Link href="/" className="text-sm text-[var(--accent)] underline">返回首页</Link>
            </div>
          ) : (
            <>
              {/* 状态栏 */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[var(--text-dim)]">
                  {loading
                    ? '读取中...'
                    : `${nodes.length} 个节点 · ${edgeList.length} 条连线 · 拖动节点右下角圆点连到另一个节点 · ${saving ? '保存中…' : '改动自动保存'}`}
                </span>
              </div>

              <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                {/* ========== 左侧：筛选 + 列表 ========== */}
                <div className="w-full lg:w-72 flex-shrink-0 neu-card p-3 flex flex-col h-[420px] lg:h-[680px]">
                  {loading ? (
                    /* Loading 骨架 */
                    <div className="flex-1 flex items-center justify-center">
                      <div className="flex items-center gap-2 text-sm text-[var(--text-dim)]">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                        加载列表...
                      </div>
                    </div>
                  ) : (
                    <>
                      <input value={listSearch} onChange={e => setListSearch(e.target.value)}
                        placeholder="搜索桶名或内容…"
                        className="neu-input w-full text-sm px-3 py-1.5 mb-2 text-[var(--text)]" />
                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                        {(['all', ...TYPES] as const).map(t => (
                          <button key={t} onClick={() => setTypeFilter(t)}
                            className={`neu-pill text-xs px-2.5 py-1 ${typeFilter === t ? 'active' : ''}`}>
                            {t === 'all' ? '全部' : TYPE_LABEL[t]}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <select value={sortBy} onChange={e => setSortBy(e.target.value as 'score' | 'importance' | 'created')}
                          className="neu-select text-xs px-2 py-1.5 flex-1">
                          <option value="score">权重</option>
                          <option value="importance">重要度</option>
                          <option value="created">时间</option>
                        </select>
                        <button onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
                          className={`neu-pill text-xs px-2.5 py-1.5 ${sortOrder === 'desc' ? 'active' : ''}`}>
                          {sortOrder === 'desc' ? '↓' : '↑'}
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1.5 -mr-1 pr-1 custom-scroll">
                        {listItems.map(b => {
                          const inGraph = includedIds.has(b.id)
                          const isSel = selectedId === b.id
                          return (
                            <div key={b.id} onClick={() => setSelectedId(b.id)}
                              className={`list-item px-2.5 py-2 ${isSel ? 'active' : ''}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-[var(--text)] truncate">{b.name}</span>
                                {!inGraph && (
                                  <button onClick={e => { e.stopPropagation(); toggleNodeInGraph(b.id) }}
                                    className="text-[10px] text-[var(--accent)] flex-shrink-0 hover:underline whitespace-nowrap">加入图谱</button>
                                )}
                              </div>
                              <p className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">{b.content_preview}</p>
                            </div>
                          )
                        })}
                        {listItems.length === 0 && (
                          <div className="text-xs text-[var(--text-light)] text-center py-6">没有匹配的桶</div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* ========== 中间：图谱 ========== */}
                <div className="flex-1 flex flex-col gap-2">
                  {!loading && (
                    /* 图例 */
                    <div className="flex items-center gap-4 text-xs text-[var(--text-dim)] px-1">
                      {(['dynamic', 'permanent', 'feel'] as const).map(t => (
                        <div key={t} className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLORS[t].border }} />
                          <span>{TYPE_LABEL[t]}</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
                        <span>已选</span>
                      </div>
                    </div>
                  )}

                  <div ref={containerRef}
                    className="relative flex-1 neu-inset overflow-hidden select-none h-[390px] lg:h-[648px]"
                    onClick={() => setSelectedId(null)}>

                    {loading ? (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-dim)]">
                        <div className="flex items-center gap-3">
                          <span className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                          加载图谱...
                        </div>
                      </div>
                    ) : nodes.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-light)] text-center px-6">
                        图谱是空的，从左边列表里把桶"加入图谱"
                      </div>
                    ) : (
                      <>
                        <svg className="absolute inset-0 w-full h-full pointer-events-none">
                          {edgeList.map(([a, b]) => {
                            const pa = positions[a]; const pb = positions[b]
                            if (!pa || !pb) return null
                            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="var(--accent)" strokeWidth={1.5} strokeOpacity={0.35} />
                          })}
                          {connecting && positions[connecting.from] && (
                            <line x1={positions[connecting.from].x} y1={positions[connecting.from].y}
                              x2={connecting.x} y2={connecting.y}
                              stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
                          )}
                        </svg>

                        {nodes.map(n => {
                          const pos = positions[n.id]
                          if (!pos) return null
                          const r = radiusFor(n.importance)
                          const isSel = selectedId === n.id
                          const tc = TYPE_COLORS[n.type] ?? { fill: '#FFFFFF', border: 'var(--border)', text: 'var(--text)' }
                          return (
                            <div key={n.id}
                              onMouseDown={e => onNodeMouseDown(e, n.id)}
                              onClick={e => { e.stopPropagation(); setSelectedId(n.id) }}
                              className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-grab active:cursor-grabbing rounded-full text-center px-1.5 leading-tight font-medium shadow-sm border-2 transition-shadow ${isSel ? 'graph-node-highlight' : ''}`}
                              style={{
                                left: pos.x, top: pos.y, width: r * 2, height: r * 2,
                                fontSize: r > 32 ? 11 : 10,
                                background: isSel ? '#FDF0ED' : (n.pinned ? '#FFFBF0' : tc.fill),
                                borderColor: isSel ? 'var(--accent)' : (n.pinned ? '#E8A23A' : tc.border),
                                color: isSel ? '#B65D40' : (n.pinned ? '#8A6A1F' : tc.text),
                                boxShadow: isSel ? '0 0 0 4px var(--accent-glow)' : '0 1px 3px var(--shadow-dark-subtle)',
                              }}>
                              {n.name?.length > 12 ? n.name.slice(0, 11) + '…' : n.name}
                              <div onMouseDown={e => onHandleMouseDown(e, n.id)}
                                title="拖到另一个节点上连线"
                                className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white cursor-crosshair hover:scale-110 transition-transform"
                                style={{ background: 'var(--accent)' }} />
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                </div>

                {/* ========== 右侧：详情面板 ========== */}
                <div className="w-full lg:w-80 flex-shrink-0 neu-card p-4 h-[420px] lg:h-[680px] overflow-y-auto custom-scroll">
                  {loading ? (
                    <div className="text-sm text-[var(--text-light)] text-center py-10">加载中...</div>
                  ) : !selectedNode ? (
                    <div className="text-sm text-[var(--text-light)] text-center py-10">点一个桶查看详情</div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-[var(--text)]">{selectedNode.name}</span>
                        {selectedNode.pinned && <span className="text-xs" style={{ color: '#B8860B' }}>★钉选</span>}
                        {selectedNode.wish && <span className="text-xs" style={{ color: '#B8860B' }}>✦悬念</span>}
                      </div>
                      <div className="text-[11px] text-[var(--text-dim)] mb-3">
                        {TYPE_LABEL[selectedNode.type] ?? selectedNode.type} · 重要度 {selectedNode.importance}
                        {!selectedInGraph && <span className="ml-2 text-[var(--accent)]">未在图谱中</span>}
                      </div>
                      <p className="text-sm text-[var(--text)] leading-relaxed mb-4 whitespace-pre-wrap opacity-80">{selectedNode.content_preview}</p>

                      <div className="flex items-center gap-3 mb-4 flex-wrap">
                        <button onClick={() => openBucketDetail(selectedNode.id)} className="neu-btn-primary text-xs px-4 py-1.5">查看详情</button>
                        {selectedInGraph ? (
                          <button onClick={() => toggleNodeInGraph(selectedNode.id)} className="text-xs text-[var(--text-dim)] hover:text-[#C64B45] hover:underline">移出图谱</button>
                        ) : (
                          <button onClick={() => toggleNodeInGraph(selectedNode.id)} className="text-xs text-[var(--accent)] hover:underline">加入图谱</button>
                        )}
                      </div>

                      <div className="border-t border-[var(--border)] pt-3">
                        <div className="text-xs font-medium text-[var(--text)] mb-2">关联记忆 · {selectedNode.related?.length ?? 0}</div>
                        <div className="space-y-1.5 mb-3">
                          {(selectedNode.related ?? []).map(rid => {
                            const rb = allBuckets.find(b => b.id === rid)
                            if (!rb) return null
                            const rInGraph = includedIds.has(rid)
                            return (
                              <div key={rid} className="related-item px-2.5 py-2 flex items-center justify-between gap-2">
                                <div className="min-w-0 cursor-pointer" onClick={() => setSelectedId(rid)}>
                                  <div className="text-xs font-medium text-[var(--text)] truncate">{rb.name}</div>
                                  <div className="text-[11px] text-[var(--text-dim)] truncate">{rb.content_preview}</div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {!rInGraph && (
                                    <button onClick={() => toggleNodeInGraph(rid)} className="text-[10px] text-[var(--accent)] hover:underline whitespace-nowrap">加入</button>
                                  )}
                                  <button onClick={() => toggleEdge(selectedNode.id, rid)} className="text-[10px] text-[var(--text-light)] hover:text-[#C64B45] hover:underline">✕</button>
                                </div>
                              </div>
                            )
                          })}
                          {(selectedNode.related ?? []).length === 0 && (
                            <div className="text-xs text-[var(--text-light)]">还没有关联记忆</div>
                          )}
                        </div>

                        <div className="relative">
                          <input value={addRelSearch} onChange={e => setAddRelSearch(e.target.value)}
                            placeholder="+ 添加关联记忆…"
                            className="neu-input w-full text-xs px-3 py-1.5" />
                          {addRelResults.length > 0 && (
                            <div className="dropdown-results absolute z-20 mt-1 w-full">
                              {addRelResults.map(b => (
                                <div key={b.id} onClick={() => addRelation(b.id)}
                                  className="px-3 py-2 text-xs hover:bg-[var(--accent-glow)] cursor-pointer truncate text-[var(--text)]">{b.name}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <BucketDetailDrawer
        selected={detailSelected}
        detailLoading={detailLoading}
        editing={editing}
        editContent={editContent}
        saving={savingDetail}
        operating={operating}
        copied={copied}
        onClose={() => { setDetailSelected(null); setEditing(false) }}
        onStartEdit={(content) => { setEditing(true); setEditContent(content) }}
        onCancelEdit={() => setEditing(false)}
        onSaveEdit={saveEdit}
        onTraceOp={traceOp}
        onCopyId={copyId}
        onTouch={async (id) => {
          await fetch(`/api/touch/${id}`, { method: 'POST' })
        }}
        onArchive={async (id) => {
          await fetch(`/api/archive/${id}`, { method: 'POST' })
        }}
        onActivate={async (id) => {
          await fetch(`/api/touch/${id}?ripple=true`, { method: 'POST' })
        }}
      />
    </>
  )
}
