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

const STATUS_LABELS: Record<string, string> = {
  '已精修': '✓ 已阅',
  '存疑': '? 存疑',
}

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

  // 加载状态桶 + 所有桶
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
    }
    load()
  }, [])

  // 过滤队列
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

  // 加载当前卡片详情
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
    // 自动推进到下一张
    if (filter !== '全部') setCurrent(c => Math.max(0, Math.min(c, queue.length - 2)))
  }, [statusMap, statesBucketId, filter, queue.length])

  const getContent = (b: FullBucket | null) => {
    if (!b) return ''
    if (typeof b.content === 'string') return b.content
    return b.content?.raw ?? ''
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">加载中…</div>

  const cur = queue[current]

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 min-h-screen">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <a href="/" className="text-gray-400 hover:text-gray-200 text-sm">← 返回</a>
          <span className="text-white font-semibold">审阅 · REVIEW</span>
          {queue.length > 0 && (
            <span className="text-gray-400 text-sm">{current + 1}/{queue.length}</span>
          )}
        </div>
        <div className="flex gap-1">
          {(['今天', '全部'] as const).map(t => (
            <button key={t} onClick={() => { setTimeFilter(t); setCurrent(0) }}
              className={`px-3 py-1 rounded text-sm ${timeFilter === t ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 状态栏 */}
      <div className="flex gap-3 mb-6 text-sm">
        {(['待办', '存疑', '已精修', '全部'] as const).map(f => (
          <button key={f} onClick={() => { setFilter(f); setCurrent(0) }}
            className={`flex items-center gap-1 px-3 py-1 rounded-full border transition-colors ${filter === f ? 'border-orange-500 text-orange-400' : 'border-gray-700 text-gray-400'}`}>
            <span className={f === '待办' ? 'text-yellow-400' : f === '存疑' ? 'text-red-400' : f === '已精修' ? 'text-green-400' : 'text-gray-400'}>●</span>
            {f} {f !== '全部' ? counts[f as keyof typeof counts] : buckets.length}
          </button>
        ))}
      </div>

      {/* 卡片 */}
      {!cur ? (
        <div className="text-center text-gray-500 mt-20">
          {filter === '待办' ? '全部审阅完啦 🎉' : '这里什么都没有'}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-4">
          {/* 元信息 */}
          <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
            <span>{cur.created?.slice(0, 10)}</span>
            <div className="flex gap-2">
              {statusMap[cur.id] && (
                <span className="px-2 py-0.5 rounded-full bg-green-900 text-green-400">{statusMap[cur.id]}</span>
              )}
              <span>imp {cur.importance ?? '-'}</span>
              {cur.score !== undefined && <span className="text-orange-400">score {cur.score}</span>}
            </div>
          </div>

          {/* 标签 */}
          {cur.tags && cur.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {cur.tags.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{t}</span>
              ))}
            </div>
          )}

          {/* 标题 */}
          <h2 className="text-lg font-semibold text-white mb-3">{cur.name}</h2>

          {/* 内容 */}
          <div className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {fullBucket ? getContent(fullBucket) : <span className="text-gray-600">加载中…</span>}
          </div>
        </div>
      )}

      {/* 操作栏 */}
      {cur && (
        <div className="flex gap-2">
          <button onClick={() => updateStatus(cur.id, '已精修')} disabled={saving}
            className="flex-1 py-3 rounded-lg bg-green-900 text-green-300 hover:bg-green-800 transition-colors text-sm font-medium">
            ✓ 已阅
          </button>
          <button onClick={() => updateStatus(cur.id, '存疑')} disabled={saving}
            className="flex-1 py-3 rounded-lg bg-gray-800 text-yellow-400 hover:bg-gray-700 transition-colors text-sm font-medium">
            ? 存疑
          </button>
          <button onClick={() => updateStatus(cur.id, null)} disabled={saving}
            className="flex-1 py-3 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors text-sm font-medium">
            ↺ 重置
          </button>
          <a href={`/bucket/${cur.id}`}
            className="flex-1 py-3 rounded-lg bg-gray-800 text-blue-400 hover:bg-gray-700 transition-colors text-sm font-medium text-center">
            ✎ 编辑
          </a>
        </div>
      )}

      {/* 翻页 */}
      {queue.length > 1 && (
        <div className="flex justify-between mt-4">
          <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
            className="px-4 py-2 rounded bg-gray-800 text-gray-400 disabled:opacity-30 text-sm">← 上一条</button>
          <button onClick={() => setCurrent(c => Math.min(queue.length - 1, c + 1))} disabled={current === queue.length - 1}
            className="px-4 py-2 rounded bg-gray-800 text-gray-400 disabled:opacity-30 text-sm">下一条 →</button>
        </div>
      )}
    </div>
  )
}
