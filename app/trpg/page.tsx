'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useDoubleConfirm } from '@/app/lib/useDoubleConfirm'
import Card from '@/app/components/Card'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { endedDate, fieldClass, phaseLabel, trpgRequest, type Phase } from '@/app/lib/trpg/table'

type Module = { id: string; title: string }
type Game = { id: string; title: string; phase: Phase; ended_at: string | null; module_id: string }
type Pregen = { index: number; name: string; occupation: string }
type Upload = { title: string; scenes_count: number; clues_count: number; npcs_count: number }

export default function TrpgPage() {
  const router = useRouter()
  const { armed, confirm } = useDoubleConfirm()
  const [blockedModules, setBlockedModules] = useState<string[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [modules, setModules] = useState<Module[]>([])
  const [moduleId, setModuleId] = useState('')
  const [pregens, setPregens] = useState<Pregen[]>([])
  const [choices, setChoices] = useState({ xiaoyang: 0, yanzhi: 1 })
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uploaded, setUploaded] = useState<Upload | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    Promise.all([trpgRequest<Game[]>('games'), trpgRequest<Module[]>('modules')])
      .then(([g, m]) => { if (live) { setGames(g); setModules(m); setModuleId(m[0]?.id || '') } })
      .catch(e => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    if (moduleId) {
      trpgRequest<Pregen[]>(`modules/${encodeURIComponent(moduleId)}/pregens`)
        .then(p => { if (live) { setPregens(p); setChoices({ xiaoyang: p[0]?.index ?? 0, yanzhi: p[1]?.index ?? p[0]?.index ?? 0 }) } })
        .catch(e => { if (live) setError(e.message) })
    }
    return () => { live = false }
  }, [moduleId])

  const active = games.some(game => !game.ended_at)

  async function deleteModule(id: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/trpg/modules/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (response.status === 409) { setBlockedModules(ids => [...ids, id]); return }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '删除失败')
      const remaining = modules.filter(module => module.id !== id)
      setModules(remaining)
      if (moduleId === id) { setPregens([]); setModuleId(remaining[0]?.id || '') }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function create() {
    setBusy(true); setError('')
    try {
      const game = await trpgRequest<Game>('games', { module_id: moduleId, ...(title.trim() ? { title: title.trim() } : {}), characters: choices })
      router.push(`/trpg/${game.id}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function upload(file: File) {
    setBusy(true); setError(''); setUploaded(null)
    try {
      // Send the opaque file to Haven: never parse or render module contents here.
      const response = await fetch('/api/trpg/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '上传失败')
      setUploaded({ title: result.title, scenes_count: result.scenes_count, clues_count: result.clues_count, npcs_count: result.npcs_count })
      const m = await trpgRequest<Module[]>('modules')
      setModules(m)
      if (!moduleId && m.length) { setPregens([]); setModuleId(m[0].id) }
    } catch (e) { setError((e as Error).message) } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 pb-24 pt-5 text-[var(--color-text-primary)] sm:px-6">
    <SubpageBackButton href="/games" label="返回游戏室" />
    <h1 className="text-3xl font-[family-name:var(--font-display)]">跑团</h1>
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    {loading ? <p role="status">正在摆好桌子…</p> : <>
      <section className="space-y-3" aria-label="局列表">
        {([false, true] as const).map(ended => <section key={String(ended)} className="space-y-3"><h2 className="text-xl">{ended ? '结束的局' : '进行中'}</h2>{games.filter(game => Boolean(game.ended_at) === ended).map(game => <Link className="block" key={game.id} href={`/trpg/${game.id}`}><Card variant="interactive"><h3 className="text-lg">{game.title}</h3><p className="text-sm text-[var(--color-text-secondary)]">{game.ended_at ? `这局结束了 · ${endedDate(game.ended_at)}` : phaseLabel[game.phase]}</p></Card></Link>)}</section>)}
        {!games.length && <Card variant="empty">还没有局，选好调查员就能建一局。</Card>}
      </section>
      <Card><h2 className="mb-4 text-xl">新建局</h2><div className="space-y-4">
        {active && <p className="text-sm text-[var(--color-text-secondary)]">已经有一局在跑了，结束这局后才能新建。</p>}
        <label className="block text-sm">模组<select className={`${fieldClass} mt-1`} value={moduleId} disabled={busy || !modules.length} onChange={e => { setPregens([]); setModuleId(e.target.value) }}><option value="" disabled>选择模组</option>{modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        {(['xiaoyang', 'yanzhi'] as const).map(owner => <label key={owner} className="block text-sm">{owner === 'xiaoyang' ? '小羊' : '言之'}的调查员<select className={`${fieldClass} mt-1`} disabled={busy || !pregens.length} value={choices[owner]} onChange={e => setChoices(c => ({ ...c, [owner]: Number(e.target.value) }))}>{pregens.length ? pregens.map(p => <option key={p.index} value={p.index}>{p.name} · {p.occupation}</option>) : <option>暂无可选调查员</option>}</select></label>)}
        <label className="block text-sm">局名（选填）<input className={`${fieldClass} mt-1`} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <button className="cc-btn-primary min-h-11" disabled={busy || active || !moduleId || !pregens.length} onClick={() => void create()}>创建</button>
      </div></Card>
      <Card><h2 className="mb-3 text-xl">模组</h2><div className="space-y-3">{modules.map(module => {
        const blocked = games.some(game => !game.ended_at && game.module_id === module.id) || blockedModules.includes(module.id)
        return <div key={module.id} className="flex flex-wrap items-center justify-between gap-2"><span>{module.title}</span><button className="bucket-erase min-h-11 text-xs" style={{ color: 'var(--color-danger)', minHeight: '2.75rem' }} data-armed={armed === module.id} disabled={busy || blocked} onClick={() => confirm(module.id, () => { void deleteModule(module.id) })}>{armed === module.id ? '再点一次，删除模组' : '删除'}</button>{blocked && <p className="w-full text-xs text-[var(--color-text-secondary)]">这局结束后才能删</p>}</div>
      })}</div></Card>
      <Card><h2 className="mb-3 text-xl">上传模组</h2><div className="flex flex-wrap items-center gap-3"><button className="cc-btn-ghost min-h-11" disabled={busy} onClick={() => fileInput.current?.click()}>选择 JSON 文件</button><span className="text-xs text-[var(--color-text-secondary)]">交给 DM，别打开</span></div><input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file) }} />{uploaded && <p role="status" className="mt-3 text-sm">{uploaded.title} · {uploaded.scenes_count} 个场景 · {uploaded.clues_count} 条线索 · {uploaded.npcs_count} 位 NPC</p>}</Card>
    </>}
  </main>
}
