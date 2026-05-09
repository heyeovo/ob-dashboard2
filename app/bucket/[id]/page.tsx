'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

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
  content: string
}

export default function BucketPage() {
  const { id } = useParams()
  const router = useRouter()
  const [bucket, setBucket] = useState<Bucket | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/bucket/${id}`)
      .then(r => r.json())
      .then(data => {
        setBucket(data)
        setLoading(false)
      })
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center h-screen text-gray-400">加载中...</div>
  )
  if (!bucket) return (
    <div className="flex items-center justify-center h-screen text-gray-400">找不到</div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 max-w-2xl mx-auto">
      <button
        onClick={() => router.back()}
        className="text-gray-400 hover:text-gray-200 mb-6 flex items-center gap-1"
      >
        ← 返回
      </button>

      <div className="flex items-center gap-2 mb-2">
        {bucket.pinned && <span className="text-yellow-400">📌</span>}
        <h1 className="text-2xl font-bold">{bucket.name}</h1>
        {bucket.resolved && (
          <span className="text-xs bg-gray-600 px-2 py-0.5 rounded text-gray-300">已解决</span>
        )}
      </div>

      <div className="flex gap-4 text-sm text-gray-400 mb-4">
        <span>重要度 {bucket.importance}/10</span>
        <span>情感 {bucket.valence?.toFixed(1)}</span>
        <span>创建 {new Date(bucket.created).toLocaleDateString('zh-CN')}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-6">
 {(bucket.domain ?? []).map(d => (
  <span key={d} className="text-xs bg-gray-700 px-2 py-0.5 rounded text-gray-300">{d}</span>
))}
{(bucket.tags ?? []).map(t => (
  <span key={t} className="text-xs bg-gray-900 px-2 py-0.5 rounded text-gray-400">{t}</span>
))}
      </div>

      <div className="bg-gray-800 rounded-lg p-5 text-gray-200 leading-relaxed whitespace-pre-wrap">
        {bucket.content}
      </div>
    </div>
  )
}