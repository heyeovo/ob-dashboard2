'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import DetailPanel from '@/app/components/DetailPanel'
import SearchBar from '@/app/components/SearchBar'
import { getBeijingDayOfWeek } from '@/app/utils/format'
import { getMonthChapters } from '@/app/memory/memoryFilters'
import type { Bucket } from '@/app/memory/memoryTypes'
import { Author, JournalEntry, journalDate, MONTHS_ZH, sortJournals, toBeijingIso } from './journalData'

function nowLocal() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(' ', 'T')
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [chapters, setChapters] = useState<ReturnType<typeof getMonthChapters>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeMonth, setActiveMonth] = useState('')
  const [yearMenu, setYearMenu] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', content: '', author: '共同' as Author, eventTime: nowLocal(), locked: false, unlockHint: '' })
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [journals, buckets] = await Promise.all([fetch('/api/journal'), fetch('/api/buckets?full=1')])
      if (!journals.ok) throw new Error('读取日记失败')
      setEntries(await journals.json())
      if (buckets.ok) {
        const data = await buckets.json()
        setChapters(getMonthChapters((Array.isArray(data) ? data : data.buckets || []) as Bucket[]))
      }
    } catch (reason) { setError(String(reason)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const y = sessionStorage.getItem('journal-scroll'); if (y && !loading) requestAnimationFrame(() => window.scrollTo(0, Number(y))) }, [loading])

  const ordered = useMemo(() => sortJournals(entries), [entries])
  const filtered = useMemo(() => ordered.filter(entry => !search.trim() || `${entry.name} ${entry.content || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [ordered, search])
  const months = useMemo(() => {
    const groups = new Map<string, JournalEntry[]>()
    for (const entry of filtered) { const month = journalDate(entry).slice(0, 7); if (!groups.has(month)) groups.set(month, []); groups.get(month)!.push(entry) }
    return Array.from(groups.entries())
  }, [filtered])
  const years = [...new Set(months.map(([month]) => month.slice(0, 4)))]
  useEffect(() => {
    const update = () => {
      const visible = months.filter(([month]) => (document.getElementById(`journal-${month}`)?.getBoundingClientRect().top ?? Infinity) <= 160)
      setActiveMonth(visible.at(-1)?.[0] || months[0]?.[0] || '')
    }
    window.addEventListener('scroll', update, { passive: true })
    update()
    return () => window.removeEventListener('scroll', update)
  }, [months, loading])
  const counts = { yz: entries.filter(e => e.author === '言之').length, xy: entries.filter(e => e.author === '小羊').length, together: entries.filter(e => e.author === '共同').length }
  const field = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-base'

  function jump(month: string) { document.getElementById(`journal-${month}`)?.scrollIntoView({ behavior: 'smooth' }); setActiveMonth(month); setYearMenu(false) }
  async function submit() {
    if (!form.content.trim()) return
    setSubmitting(true)
    try {
      const response = await fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.trim() || undefined, content: form.content, author: form.author, event_time: toBeijingIso(form.eventTime), locked: form.locked, unlock_hint: form.locked ? form.unlockHint : '' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '创建失败')
      setShowAdd(false); await load()
    } catch (reason) { setError(String(reason)) } finally { setSubmitting(false) }
  }

  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-5 text-[var(--color-text-primary)]">
    <div className="flex items-center justify-between"><SubpageBackButton href="/" label="返回主页" />{years.length > 1 && <div className="relative"><button type="button" onClick={() => setYearMenu(!yearMenu)} aria-label="选择年份" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] shadow-[var(--glass-shadow)]">▦</button>{yearMenu && <div className="cc-popmenu absolute right-0 top-11 z-20 rounded-[var(--radius-xl)] p-2">{years.map(year => <button key={year} type="button" onClick={() => jump(months.find(([month]) => month.startsWith(year))![0])} className="block w-full px-4 py-2 text-left font-[var(--font-display)]">{year}</button>)}</div>}</div>}</div>
    <header className="mt-5"><p className="text-xs uppercase tracking-[var(--label-tracking)] text-[var(--color-primary)]">JOURNAL · 日记本</p><h1 className="mt-1 font-[var(--font-display)] text-3xl text-[var(--color-text-heading)]">日记本</h1><p className="mt-2 text-sm text-[var(--color-text-tertiary)]">言之 {counts.yz} · 小羊 {counts.xy} · 一起写的 {counts.together}</p></header>
    <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{months.map(([month, items], index) => <div key={month} className="flex shrink-0 items-center gap-2">{years.length > 1 && (index === 0 || months[index - 1][0].slice(0, 4) !== month.slice(0, 4)) && <span className="font-[var(--font-display)] text-xs text-[var(--color-text-tertiary)]">{month.slice(0, 4)}</span>}<button type="button" onClick={() => jump(month)} className={`rounded-full px-3 py-1.5 text-xs ${activeMonth === month || (!activeMonth && index === 0) ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'}`}>{MONTHS_ZH[Number(month.slice(5)) - 1]} {items.length}</button></div>)}</div>
    <div className="mt-3"><SearchBar value={search} onChange={setSearch} placeholder="搜索日记标题或内容…" /></div>
    {error && <p className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-danger-bg)] p-3 text-sm text-[var(--color-danger)]">{error}</p>}
    {loading ? <p className="py-12 text-sm text-[var(--color-text-tertiary)]">读取中…</p> : !filtered.length ? <p className="py-16 text-center text-sm text-[var(--color-text-tertiary)]">{search ? '没有匹配的日记' : '还没有日记'}</p> : months.map(([month, items], index) => {
      const monthNumber = Number(month.slice(5))
      const days = new Map<string, JournalEntry[]>()
      for (const entry of items) { const day = journalDate(entry); if (!days.has(day)) days.set(day, []); days.get(day)!.push(entry) }
      return <section id={`journal-${month}`} key={month} className="scroll-mt-5 pt-7">{years.length > 1 && (index === 0 || months[index - 1][0].slice(0, 4) !== month.slice(0, 4)) && <div className="mb-4 font-[var(--font-display)] text-3xl">{month.slice(0, 4)}</div>}<p className="text-xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">{new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2000, monthNumber - 1))} {month.slice(0, 4)}</p><h2 className="mt-1 font-[var(--font-display)] text-xl">{MONTHS_ZH[monthNumber - 1]} <span className="ml-2 text-sm text-[var(--color-text-tertiary)]">{chapters[month]?.name}</span></h2>{Array.from(days.entries()).map(([day, list]) => <div key={day} className="mt-5"><div className="mb-3 flex items-baseline gap-2"><span className="font-[var(--font-display)] text-2xl">{Number(day.slice(8))}</span><span className="text-xs text-[var(--color-text-tertiary)]">{getBeijingDayOfWeek(`${day}T12:00:00+08:00`)}</span></div><div className="space-y-2">{list.map(entry => <Link key={entry.id} href={`/journal/${encodeURIComponent(entry.id)}`} onClick={() => sessionStorage.setItem('journal-scroll', String(window.scrollY))} className="block rounded-[var(--radius-reading-card)] border border-[var(--color-border-light)] bg-[var(--memory-card-fill)] p-4 shadow-[var(--memory-card-shadow)]"><div className="flex justify-between gap-2 text-xs text-[var(--color-text-tertiary)]"><span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${entry.author === '言之' ? 'bg-[var(--color-primary)]' : entry.author === '小羊' ? 'journal-author-sheep' : 'journal-author-joint'}`} />{entry.author === '共同' ? '一起写的' : entry.author}</span><span>{(entry.content || '').length.toLocaleString()} 字</span></div><h3 className="mt-2 font-[var(--font-display)] text-lg">{entry.name}</h3><p className={`mt-2 text-sm leading-[1.8] text-[var(--color-text-secondary)] ${entry.locked ? 'italic' : 'line-clamp-4 whitespace-pre-wrap'}`}>{entry.locked ? `上了锁${entry.unlock_hint ? ` · ${entry.unlock_hint}` : ''}` : entry.content}</p></Link>)}</div></div>)}</section>
    })}
    <DetailPanel open={showAdd} onClose={() => setShowAdd(false)} mode="modal" width="max-w-2xl"><div className="flex max-h-[var(--journal-dialog-max-height)] flex-col gap-3 p-1"><h2 className="font-[var(--font-display)] text-xl">写新日记</h2><input aria-label="标题" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="标题（可选）" className={field} /><input aria-label="日记时间" type="datetime-local" value={form.eventTime} onChange={e => setForm({ ...form, eventTime: e.target.value })} className={field} /><textarea aria-label="正文" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="写点什么…" className={`${field} min-h-[var(--journal-new-body-min-height)] flex-1`} /><div className="flex items-center gap-2">{(['言之', '小羊', '共同'] as Author[]).map(value => <button key={value} type="button" onClick={() => setForm({ ...form, author: value })} className={`rounded-full px-3 py-1.5 text-xs ${form.author === value ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface-tertiary)]'}`}>{value}</button>)}<label className="ml-auto text-xs"><input type="checkbox" checked={form.locked} onChange={e => setForm({ ...form, locked: e.target.checked })} className="accent-[var(--color-primary)]" /> 上锁</label></div>{form.locked && <input aria-label="解锁提示" value={form.unlockHint} onChange={e => setForm({ ...form, unlockHint: e.target.value })} placeholder="解锁提示" className={field} />}<div className="flex justify-end gap-3"><button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm">取消</button><button type="button" onClick={() => void submit()} disabled={submitting || !form.content.trim()} className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm text-[var(--color-on-primary)] disabled:opacity-50">{submitting ? '保存中…' : '保存日记'}</button></div></div></DetailPanel>
    <button type="button" onClick={() => { setForm({ name: '', content: '', author: '共同', eventTime: nowLocal(), locked: false, unlockHint: '' }); setShowAdd(true) }} aria-label="写新日记" className="fixed bottom-28 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)] text-xl text-[var(--color-on-primary)] shadow-[var(--shadow-md)] md:bottom-8">＋</button>
  </main>
}
