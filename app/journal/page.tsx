'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatBeijingDateTime } from '@/app/utils/format'

interface JournalEntry {
  id: string
  name: string
  author: string
  created: string
  locked: boolean
  content: string | null
  unlock_hint?: string
}

type Author = '言之' | '小羊' | '共同'

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [author, setAuthor] = useState<Author>('共同')
  const [locked, setLocked] = useState(false)
  const [unlockHint, setUnlockHint] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/journal')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '读取失败')
      setEntries(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => {
    setContent(''); setName(''); setAuthor('共同'); setLocked(false); setUnlockHint('')
  }

  const submit = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          name: name.trim() || undefined,
          author,
          locked,
          unlock_hint: locked ? unlockHint : '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '创建失败')
      resetForm()
      setShowForm(false)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const authorColor = (a: string) =>
    a === '言之' ? 'bg-[#FDF0ED] text-[#D97757]'
    : a === '小羊' ? 'bg-[#EDF4FC] text-[#3B72B9]'
    : 'bg-[#F4F2EC] text-[#6C6965]'

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
          <Link href="/graph" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">关系图谱</Link>
          <span className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[#3A3836] border-b-2 border-[#D97757]">日记</span>
          <Link href="/prompts" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">权重配置</Link>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold text-[#3A3836]">日记</h1>
          <button
            onClick={() => setShowForm(v => !v)}
            className="text-sm bg-[#D97757] text-white px-4 py-1.5 rounded-lg hover:bg-[#B65D40] transition-colors"
          >
            {showForm ? '收起' : '写新日记'}
          </button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-[#C64B45] bg-[#FDEDEC] border border-[#F3C9C6] rounded-lg px-3 py-2">{error}</div>
        )}

        {showForm && (
          <div className="bg-white border border-[#E8E6E1] rounded-xl p-4 mb-6">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="标题（可选，留空自动生成）"
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 mb-3 outline-none focus:border-[#D97757]"
            />
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="写点什么…"
              rows={8}
              className="w-full text-sm border border-[#E8E6E1] rounded-lg px-3 py-2 mb-3 outline-none focus:border-[#D97757] resize-none leading-relaxed"
            />
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                {(['言之', '小羊', '共同'] as Author[]).map(a => (
                  <button
                    key={a}
                    onClick={() => setAuthor(a)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                      author === a ? authorColor(a) : 'bg-white border border-[#E8E6E1] text-[#8A8681] hover:bg-[#F9F8F6]'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-[#6C6965] cursor-pointer">
                <input type="checkbox" checked={locked} onChange={e => setLocked(e.target.checked)} className="accent-[#D97757]" />
                上锁
              </label>
            </div>
            {locked && (
              <input
                value={unlockHint}
                onChange={e => setUnlockHint(e.target.value)}
                placeholder="解锁提示（日期如 2026-07-01 到点自动解锁，其他文本则保持锁定当提示用）"
                className="w-full text-xs border border-[#E8E6E1] rounded-lg px-3 py-2 mt-3 outline-none focus:border-[#D97757]"
              />
            )}
            <div className="flex justify-end mt-3">
              <button
                onClick={submit}
                disabled={submitting || !content.trim()}
                className="text-sm bg-[#D97757] text-white px-4 py-1.5 rounded-lg disabled:opacity-50 hover:bg-[#B65D40] transition-colors"
              >
                {submitting ? '保存中…' : '保存日记'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-sm text-[#8A8681] py-10">读取中…</div>
        ) : entries.length === 0 ? (
          <div className="text-center text-sm text-[#A8A49D] py-10">还没有日记</div>
        ) : (
          <div className="space-y-3">
            {entries.map(e => (
              <div key={e.id} className="bg-white border border-[#E8E6E1] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${authorColor(e.author)}`}>{e.author}</span>
                    <span className="font-semibold text-sm text-[#3A3836] truncate">{e.name}</span>
                    {e.locked && <span className="text-xs flex-shrink-0">🔒</span>}
                  </div>
                  <span className="text-xs text-[#A8A49D] flex-shrink-0">{formatBeijingDateTime(e.created)}</span>
                </div>
                {e.locked ? (
                  <p className="text-sm text-[#A8A49D] italic">
                    已上锁{e.unlock_hint ? ` · 提示：${e.unlock_hint}` : ''}
                  </p>
                ) : (
                  <p className="text-sm text-[#3A3836] leading-relaxed whitespace-pre-wrap">{e.content}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
