'use client'

import { useEffect, useState } from 'react'

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
  created: string
  last_active: string
  score: number
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
    type: string
    created: string
    last_active: string
  }
}

export default function Home() {
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterResolved, setFilterResolved] = useState<'all' | 'active' | 'resolved'>('all')
  const [selected, setSelected] = useState<BucketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<Bucket[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  // state里加两个
const [editing, setEditing] = useState(false)
const [editContent, setEditContent] = useState('')
const [saving, setSaving] = useState(false)

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
  // 重新拉一次详情
  openBucket(selected.id)
}

  useEffect(() => {
    fetch('/api/buckets')
      .then(r => r.json())
      .then(data => {
        setBuckets(data)
        setLoading(false)
      })
  }, [])

  const openBucket = async (id: string) => {
    setDetailLoading(true)
    setSelected(null)
    const data = await fetch(`/api/bucket/${id}`).then(r => r.json())
    setSelected(data)
    setDetailLoading(false)
  }

  const doSearch = async (q: string) => {
    setSearch(q)
    if (!q.trim()) {
      setSearchResults(null)
      return
    }
    setSearchLoading(true)
    const data = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json())
    setSearchResults(data)
    setSearchLoading(false)
  }

  const baseList = searchResults ?? buckets
  const displayed = baseList.filter(b => {
    if (filterResolved === 'active' && b.resolved) return false
    if (filterResolved === 'resolved' && !b.resolved) return false
    return true
  })

  if (loading) return (
    <div className="flex items-center justify-center h-screen text-gray-400">加载中...</div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-6">Ombre Brain</h1>

      <div className="flex gap-3 mb-6">
        <input
          className="bg-gray-800 rounded px-3 py-2 flex-1 outline-none focus:ring-1 focus:ring-gray-500"
          placeholder="搜索桶名称..."
          value={search}
          onChange={e => doSearch(e.target.value)}
        />
        <select
          className="bg-gray-800 rounded px-3 py-2 outline-none"
          value={filterResolved}
          onChange={e => setFilterResolved(e.target.value as any)}
        >
          <option value="all">全部</option>
          <option value="active">未解决</option>
          <option value="resolved">已解决</option>
        </select>
      </div>

      <div className="flex gap-4 mb-6 text-sm text-gray-400">
        <span>共 {buckets.length} 个桶</span>
        <span>未解决 {buckets.filter(b => !b.resolved).length}</span>
        <span>已固定 {buckets.filter(b => b.pinned).length}</span>
        <span>当前显示 {displayed.length}</span>
        {searchLoading && <span>搜索中...</span>}
      </div>

      <div className="grid gap-3">
        {displayed.map(b => (
          <div
            key={b.id}
            onClick={() => openBucket(b.id)}
            className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 cursor-pointer border border-gray-700"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {b.pinned && <span className="text-yellow-400 text-xs">📌</span>}
                <span className="font-medium text-gray-100">{b.name}</span>
                {b.resolved && <span className="text-xs bg-gray-600 px-1.5 py-0.5 rounded text-gray-300">已解决</span>}
              </div>
              <span className="text-xs text-gray-500">重要度 {b.importance}</span>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2 mb-3">{b.content_preview}</p>
            <div className="flex flex-wrap gap-1.5">
              {(b.domain ?? []).map(d => (
                <span key={d} className="text-xs bg-gray-700 px-2 py-0.5 rounded text-gray-300">{d}</span>
              ))}
              {(b.tags ?? []).slice(0, 4).map(t => (
                <span key={t} className="text-xs bg-gray-900 px-2 py-0.5 rounded text-gray-400">{t}</span>
              ))}
              {(b.tags ?? []).length > 4 && (
                <span className="text-xs text-gray-500">+{(b.tags ?? []).length - 4}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {(selected || detailLoading) && (
        <div
          className="fixed inset-0 bg-black/60 z-40 flex justify-end"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-gray-900 w-full max-w-lg h-full overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="flex items-center justify-center h-full text-gray-400">加载中...</div>
            ) : selected && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {selected.metadata.pinned && <span className="text-yellow-400">📌</span>}
                    <h2 className="text-xl font-bold">{selected.metadata.name}</h2>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-200 text-xl">✕</button>
                </div>

                <div className="flex gap-4 text-sm text-gray-400 mb-4">
                  <span>重要度 {selected.metadata.importance}/10</span>
                  <span>情感 {selected.metadata.valence?.toFixed(1)}</span>
                  <span>{new Date(selected.metadata.created).toLocaleDateString('zh-CN')}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-5">
                  {(selected.metadata.domain ?? []).map(d => (
                    <span key={d} className="text-xs bg-gray-700 px-2 py-0.5 rounded text-gray-300">{d}</span>
                  ))}
                  {(selected.metadata.tags ?? []).map(t => (
                    <span key={t} className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">{t}</span>
                  ))}
                </div>

          <div className="flex items-center justify-between mb-2">
  <span className="text-sm text-gray-400">内容</span>
  {!editing ? (
    <button
      onClick={() => { setEditing(true); setEditContent(selected.content) }}
      className="text-xs text-gray-500 hover:text-gray-300"
    >
      编辑
    </button>
  ) : (
    <div className="flex gap-2">
      <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-300">取消</button>
      <button onClick={saveEdit} disabled={saving} className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50">
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )}
</div>

{editing ? (
  <textarea
    className="w-full bg-gray-800 rounded-lg p-4 text-gray-200 text-sm leading-relaxed resize-none outline-none focus:ring-1 focus:ring-gray-500"
    rows={15}
    value={editContent}
    onChange={e => setEditContent(e.target.value)}
  />
) : (
  <div className="bg-gray-800 rounded-lg p-4 text-gray-200 leading-relaxed whitespace-pre-wrap text-sm">
    {selected.content}
  </div>
)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

