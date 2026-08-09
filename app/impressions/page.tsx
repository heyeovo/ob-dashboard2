'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Persona = { id: string; name?: string }
type DailyReview = {
  review_date: string
  content: string
  updated_at?: string
  generated_at?: string
  edited_by_user?: boolean
  source_turn_count?: number
  model?: string
}

export default function DailyReviewsPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [personaId, setPersonaId] = useState('ombre')
  const [reviews, setReviews] = useState<DailyReview[]>([])
  const [editingDate, setEditingDate] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadReviews = useCallback(async (selectedPersona: string) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/daily-reviews?persona_id=${encodeURIComponent(selectedPersona)}&limit=180`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(String(data.error || `读取失败（${response.status}）`))
      setReviews(Array.isArray(data.items) ? data.items : [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取日回顾失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/cc-personas', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => {
        const items = Array.isArray(data.personas) ? data.personas : Array.isArray(data.items) ? data.items : []
        setPersonas(items)
        if (items.length > 0 && !items.some((item: Persona) => item.id === 'ombre')) setPersonaId(items[0].id)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => { void loadReviews(personaId) }, [loadReviews, personaId])

  const save = async (reviewDate: string) => {
    const content = draft.trim()
    if (!content) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/daily-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: personaId, review_date: reviewDate, content }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(String(data.error || `保存失败（${response.status}）`))
      setEditingDate('')
      await loadReviews(personaId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-tertiary)] hover:bg-black/5">← Home</Link>
            <div>
              <h1 className="text-base font-semibold">日回顾</h1>
              <p className="hidden text-xs text-[var(--color-text-disabled)] sm:block">言之写给下一个窗口自己的昨日笔记</p>
            </div>
          </div>
          <button type="button" onClick={() => void loadReviews(personaId)} className="text-xs text-[var(--color-primary)]">刷新</button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-9">
        <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-white p-4">
          <div>
            <h2 className="font-semibold text-[var(--color-text-heading)]">独立连续性笔记</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">每天凌晨 4 点生成前一天内容；不会进入普通记忆桶，也不参与语义召回。</p>
          </div>
          {personas.length > 1 && (
            <select value={personaId} onChange={event => setPersonaId(event.target.value)} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm">
              {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name || persona.id}</option>)}
            </select>
          )}
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-disabled)]">正在读取日回顾…</div>
        ) : reviews.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white px-5 py-16 text-center text-sm text-[var(--color-text-disabled)]">还没有日回顾。第一次会在有对话的次日凌晨 4 点后生成。</div>
        ) : (
          <div className="space-y-3">
            {reviews.map(review => {
              const editing = editingDate === review.review_date
              return (
                <article key={review.review_date} className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-[var(--color-text-heading)]">{review.review_date}</h2>
                      <p className="mt-0.5 text-[10.5px] text-[var(--color-text-disabled)]">
                        {review.edited_by_user ? '已手动微调' : '自动生成'}{review.source_turn_count ? ` · ${review.source_turn_count} 轮素材` : ''}
                      </p>
                    </div>
                    {!editing && <button type="button" onClick={() => { setEditingDate(review.review_date); setDraft(review.content) }} className="text-xs text-[var(--color-primary)]">微调</button>}
                  </div>
                  {editing ? (
                    <div>
                      <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={7} className="w-full resize-y rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm leading-7 outline-none focus:border-[var(--color-primary)]" />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" disabled={saving} onClick={() => setEditingDate('')} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs">取消</button>
                        <button type="button" disabled={saving || !draft.trim()} onClick={() => void save(review.review_date)} className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white disabled:opacity-40">{saving ? '保存中…' : '保存微调'}</button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-[14px] leading-7 text-[var(--color-text-secondary)]">{review.content}</p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
