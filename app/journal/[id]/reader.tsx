'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { formatBeijingDateTime } from '@/app/utils/format'
import { Author, JournalEntry, journalDate, sortJournals, toBeijingIso, toDateTimeLocal } from '../journalData'

export default function JournalReader({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ name: '', content: '', author: '共同' as Author, eventTime: '', locked: false, unlockHint: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [detailResponse, listResponse] = await Promise.all([fetch(`/api/journal/${encodeURIComponent(id)}`), fetch('/api/journal')])
      if (!detailResponse.ok || !listResponse.ok) throw new Error('读取日记失败')
      setEntry(await detailResponse.json())
      setEntries(await listResponse.json())
    } catch (reason) { setError(String(reason)) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setEditing(false); setMenu(false); setCopied(false) }, [id])

  const ordered = useMemo(() => sortJournals(entries), [entries])
  const index = ordered.findIndex(item => item.id === id)
  const previous = index > 0 ? ordered[index - 1] : null
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null

  function startEdit() {
    if (!entry) return
    setDraft({ name: entry.name, content: entry.content || '', author: entry.author as Author, eventTime: toDateTimeLocal(entry.event_time || entry.created), locked: entry.locked, unlockHint: entry.unlock_hint || '' })
    setEditing(true)
    setMenu(false)
  }

  async function save() {
    if (!entry) return
    setSaving(true)
    try {
      const response = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: draft.name.trim(), content: draft.content, author: draft.author, event_time: toBeijingIso(draft.eventTime), locked: draft.locked, unlock_hint: draft.locked ? draft.unlockHint : '' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '保存失败')
      setEntry(data)
      setEntries(current => current.map(item => item.id === id ? data : item))
      setEditing(false)
    } catch (reason) { setError(String(reason)) } finally { setSaving(false) }
  }

  async function remove() {
    if (!window.confirm('确定删除这篇日记？不可恢复。')) return
    try {
      const response = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('删除失败')
      router.push('/journal')
    } catch (reason) { setError(String(reason)) }
  }

  const date = entry ? journalDate(entry) : ''
  const dateLabel = date ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`)).toUpperCase() : ''
  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-5 text-[var(--color-text-primary)]">
    <div className="flex items-center justify-between"><SubpageBackButton href="/journal" label="返回日记本" /><div className="relative"><button type="button" onClick={() => setMenu(!menu)} aria-label="更多操作" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] shadow-[var(--glass-shadow)]">···</button>{menu && <div className="cc-popmenu absolute right-0 top-11 z-30 min-w-44 rounded-[var(--radius-xl)] p-2 text-sm"><button type="button" onClick={startEdit} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left">编辑</button><div className="border-t border-[var(--color-border-light)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">创建 · {entry ? formatBeijingDateTime(entry.created) : '—'}<br />修改 · {entry ? formatBeijingDateTime(entry.updated_at || entry.created) : '—'}</div><button type="button" onClick={() => { void navigator.clipboard.writeText(id); setCopied(true) }} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-xs">{copied ? 'ID 已复制' : '复制日记 ID'}</button><button type="button" onClick={() => void remove()} className="block w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-[var(--color-danger)]">删除</button></div>}</div></div>
    {error && <p className="mt-5 rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]">{error}</p>}
    {loading ? <p className="py-12 text-sm text-[var(--color-text-tertiary)]">读取中…</p> : !entry ? <p className="py-12 text-sm">找不到这篇日记</p> : editing ? <div className="mt-7 space-y-4"><div className="flex flex-wrap items-center gap-2"><input aria-label="日记时间" type="datetime-local" value={draft.eventTime} onChange={event => setDraft({ ...draft, eventTime: event.target.value })} className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-base" /><div className="flex gap-1">{(['言之', '小羊', '共同'] as Author[]).map(author => <button type="button" key={author} onClick={() => setDraft({ ...draft, author })} className={`rounded-full px-2 py-1 text-xs ${draft.author === author ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface)]'}`}>{author}</button>)}</div><label className="text-xs"><input type="checkbox" checked={draft.locked} onChange={event => setDraft({ ...draft, locked: event.target.checked })} className="accent-[var(--color-primary)]" /> 上锁</label></div>{draft.locked && <input aria-label="解锁提示" value={draft.unlockHint} onChange={event => setDraft({ ...draft, unlockHint: event.target.value })} placeholder="解锁提示" className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-base" />}<input aria-label="标题" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-[var(--font-display)] text-2xl" /><textarea aria-label="正文" value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} className="min-h-[var(--journal-editor-min-height)] w-full rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-base leading-loose" /><div className="flex justify-end gap-3"><button type="button" onClick={() => setEditing(false)} className="rounded-full px-4 py-2 text-sm">取消</button><button type="button" onClick={() => void save()} disabled={saving} className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm text-[var(--color-on-primary)] disabled:opacity-50">{saving ? '保存中…' : '保存'}</button></div></div> : <>
      <header className="mt-8"><p className="text-xs uppercase tracking-[var(--label-tracking)] text-[var(--color-primary)]">{dateLabel}</p><h1 className="mt-3 font-[var(--font-display)] text-3xl text-[var(--color-text-heading)]">{entry.name}</h1><p className="mt-2 text-sm text-[var(--color-text-tertiary)]">{entry.author === '共同' ? '言之和小羊一起写的' : `${entry.author}写的`}</p></header>
      <article className="journal-paper mt-8 rounded-[var(--radius-journal-paper)] border border-[var(--color-border-light)] bg-[var(--journal-paper-fill)] p-6 shadow-[var(--shadow-sm)]"><div className="whitespace-pre-wrap text-md leading-[1.95] text-[var(--color-text-primary)]">{entry.locked && !entry.content ? <p className="italic">上了锁{entry.unlock_hint ? ` · ${entry.unlock_hint}` : ''}</p> : (entry.content || '').split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><p className="mt-6 text-center font-[var(--font-display)] text-xl text-[var(--color-text-tertiary)]">~</p></article>
      <nav className="mt-7 grid grid-cols-2 gap-3">{[previous, next].map((item, position) => item ? <button key={item.id} type="button" onClick={() => router.push(`/journal/${encodeURIComponent(item.id)}`)} className="rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-surface)] p-4 text-left text-xs text-[var(--color-text-tertiary)]"><span>{position === 0 ? '‹ 前一篇' : '后一篇 ›'}</span><span className="mt-2 block truncate font-[var(--font-display)] text-sm text-[var(--color-text-primary)]">{journalDate(item)} · {item.name}</span></button> : <span key={position} />)}</nav>
    </>}
  </main>
}
