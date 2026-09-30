'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { usePersonas } from '@/app/cc/usePersonas'
import { promptSize } from './promptUtils'

export default function PromptEditor({ id, moduleId }: { id: string; moduleId?: string }) {
  const router = useRouter()
  const people = usePersonas()
  const person = people.personas.find(item => item.id === id)
  const existing = person?.promptModules.find(item => item.id === moduleId)
  const isModule = moduleId !== undefined
  const [draft, setDraft] = useState<null | { name: string; content: string; enabled: boolean }>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const initial = { name: existing?.name || '未命名模块', content: isModule ? existing?.content || '' : person?.basePrompt || '', enabled: existing?.enabledByDefault ?? true }
  const current = draft || initial
  const dirty = draft !== null && (draft.name !== initial.name || draft.content !== initial.content || draft.enabled !== initial.enabled)
  const parentHref = `/collaborators/${encodeURIComponent(id)}`
  const back = () => {
    if (dirty && !window.confirm('放弃这次修改？')) return
    router.push(parentHref)
  }

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const save = async () => {
    if (!person || !dirty) return
    if (isModule && !current.name.trim()) { setError('模块名不能为空'); return }
    const nextModule = { id: moduleId!, name: current.name.trim(), content: current.content, enabledByDefault: current.enabled }
    const next = isModule
      ? { ...person, promptModules: person.promptModules.map(item => item.id === moduleId ? nextModule : item) }
      : { ...person, basePrompt: current.content }
    const result = await people.savePersona(next)
    if (!result.ok) { setError(result.error || '保存失败'); return }
    setDraft(null)
    setError('')
    setSaved(true)
  }

  if (people.loading) return <div className="min-h-screen p-6 text-sm text-[var(--color-text-tertiary)]">读取提示词…</div>
  if (!person || (isModule && !existing)) return <div className="min-h-screen p-6"><SubpageBackButton label="返回" href={parentHref} /><p className="mt-6 text-sm">找不到这段提示词。</p></div>

  return <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-28 pt-3 text-[var(--color-text-primary)]">
    <div className="flex items-center justify-between"><SubpageBackButton label="返回提示词页" onClick={back} /><button type="button" disabled={!dirty || people.saving} onClick={() => void save()} className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-note font-semibold text-[var(--color-on-primary)] disabled:bg-[var(--color-surface-tertiary)] disabled:text-[var(--color-text-disabled)]">{people.saving ? '保存中…' : saved && !dirty ? '已保存' : '保存'}</button></div>
    {isModule ? <input aria-label="模块名" value={current.name} onChange={event => setDraft({ ...current, name: event.target.value })} className="mt-4 w-full bg-transparent font-[family-name:var(--font-display)] text-xl font-semibold tracking-[0.06em] outline-none" /> : <h1 className="mt-4 font-[family-name:var(--font-display)] text-xl font-semibold tracking-[0.06em]">基础提示词</h1>}
    <p className="mb-3 mt-1 text-meta text-[var(--color-text-tertiary)]">{promptSize(current.content)}</p>
    <textarea aria-label={isModule ? '模块内容' : '基础提示词内容'} value={current.content} onChange={event => setDraft({ ...current, content: event.target.value })} className="min-h-[50dvh] w-full flex-1 resize-none rounded-[var(--radius-2xl)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-base leading-relaxed outline-none focus:border-[var(--color-primary)]" spellCheck={false} />
    {isModule && <div className="flex items-center justify-between px-1 py-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={current.enabled} onChange={event => setDraft({ ...current, enabled: event.target.checked })} className="accent-[var(--color-primary)]" />新窗口默认开启</label><button type="button" onClick={async () => { if (!window.confirm('确定删除这个模块？')) return; const result = await people.savePersona({ ...person, promptModules: person.promptModules.filter(item => item.id !== moduleId) }); if (result.ok) router.replace(parentHref); else setError(result.error || '删除失败') }} className="text-[var(--color-danger)]">删除模块</button></div>}
    {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
  </main>
}
