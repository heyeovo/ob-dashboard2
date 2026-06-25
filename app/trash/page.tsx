'use client'
import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'

interface TrashItem {
  id: string
  name: string
  domain: string[]
  type: string
  trashed_at: string
  importance: number
  content_preview: string
}

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [operating, setOperating] = useState(false)

  const fetchTrash = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/trash')
      const data = await res.json()
      if (!data.error) setItems(data)
    } catch { }
    setLoading(false)
  }

  useEffect(() => { fetchTrash() }, [])

  const restore = async (id: string) => {
    setOperating(true)
    try {
      await fetch(`/api/bucket/${id}/restore`, { method: 'POST' })
      setItems(prev => prev.filter(it => it.id !== id))
    } catch { }
    setOperating(false)
  }

  const purge = async (id: string) => {
    if (!confirm('彻底删除后无法恢复，确认？')) return
    setOperating(true)
    try {
      await fetch(`/api/bucket/${id}/purge`, { method: 'POST' })
      setItems(prev => prev.filter(it => it.id !== id))
    } catch { }
    setOperating(false)
  }

  const emptyTrash = async () => {
    if (!confirm('清空回收站后所有内容将永久删除，确认？') || !confirm('再次确认：永久删除')) return
    setOperating(true)
    try {
      await fetch('/api/trash', { method: 'POST' })
      setItems([])
    } catch { }
    setOperating(false)
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans pb-20">
      <NavBar activeSlug="trash" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-heading)]">回收站</h1>
            <p className="text-sm text-[var(--color-text-tertiary)] mt-1">{items.length} 条已删除的记忆</p>
          </div>
          {items.length > 0 && (
            <button onClick={emptyTrash} disabled={operating}
              className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50">
              清空回收站
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center text-[var(--color-text-disabled)] py-20">读取中...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-[var(--color-text-disabled)] py-20 bg-white rounded-2xl border border-[var(--color-border)] border-dashed">
            🗑️ 回收站为空
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="bg-white border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{item.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[var(--color-text-tertiary)]">{item.id}</span>
                    <span className="text-xs bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded text-[var(--color-text-secondary)]">
                      {({ permanent: '永久', dynamic: '动态', feel: 'feel', archive: '已归档' } as any)[item.type] || item.type}
                    </span>
                    {item.trashed_at && <span className="text-xs text-[var(--color-text-disabled)]">{item.trashed_at.slice(0, 16).replace('T', ' ')}</span>}
                  </div>
                </div>
                <button onClick={() => restore(item.id)} disabled={operating}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors flex-shrink-0">
                  恢复
                </button>
                <button onClick={() => purge(item.id)} disabled={operating}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors flex-shrink-0">
                  彻底删除
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
