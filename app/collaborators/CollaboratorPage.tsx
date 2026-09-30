'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import DetailPanel from '@/app/components/DetailPanel'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { draftPersona, TINT_PRESETS, type CcPersona, type CcPromptModule } from '@/app/cc/persona'
import { usePersonas } from '@/app/cc/usePersonas'
import { promptSize } from './promptUtils'

type Field = 'name' | 'initial' | 'userName' | 'purpose'
const FIELDS: { key: Field; label: string }[] = [
  { key: 'name', label: '名字' }, { key: 'initial', label: '头像' },
  { key: 'userName', label: '称呼你' }, { key: 'purpose', label: '定位' },
]

export default function CollaboratorPage({ id }: { id: string }) {
  const router = useRouter()
  const people = usePersonas()
  const [newDraft, setNewDraft] = useState<CcPersona>(() => draftPersona())
  const [field, setField] = useState<Field | null>(null)
  const [fieldValue, setFieldValue] = useState('')
  const [tint, setTint] = useState('')
  const [hint, setHint] = useState('')
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null)
  const isNew = id === 'new'
  const person = isNew ? newDraft : people.personas.find(item => item.id === id)
  const modules = person?.promptModules || []
  const ordered = orderOverride
    ? [...modules].sort((a, b) => orderOverride.indexOf(a.id) - orderOverride.indexOf(b.id))
    : modules

  const persist = async (next: CcPersona) => {
    const result = await people.savePersona(next)
    setHint(result.ok ? '' : result.error || '保存失败')
    if (result.ok && isNew && result.persona) {
      people.selectPersona(result.persona.id)
      router.replace(`/collaborators/${encodeURIComponent(result.persona.id)}`)
    }
    return result.ok
  }

  const openField = (key: Field) => {
    if (!person) return
    setField(key)
    setFieldValue(person[key])
    setTint(person.tint)
    setHint('')
  }
  const saveField = async () => {
    if (!person || !field) return
    if (field === 'name' && !fieldValue.trim()) { setHint('名字不能为空'); return }
    const next = { ...person, [field]: field === 'initial' ? fieldValue.trim().slice(0, 2) : fieldValue.trim(), tint: field === 'initial' ? tint : person.tint }
    if (isNew) { setNewDraft(next); setField(null); return }
    if (await persist(next)) setField(null)
  }
  const saveModules = async (next: CcPromptModule[]) => {
    if (!person) return
    await persist({ ...person, promptModules: next })
  }
  const addModule = async () => {
    if (!person) return
    const moduleId = `prompt-${crypto.randomUUID()}`
    const next = { ...person, promptModules: [...modules, { id: moduleId, name: '未命名模块', content: '', enabledByDefault: false }] }
    if (await persist(next)) router.push(`/collaborators/${encodeURIComponent(id)}/modules/${encodeURIComponent(moduleId)}`)
  }
  const finishDrag = async () => {
    const drag = dragRef.current
    dragRef.current = null
    setDragId(null)
    if (!drag || !orderOverride || !person) return
    const next = orderOverride.map(moduleId => modules.find(module => module.id === moduleId)).filter((module): module is CcPromptModule => Boolean(module))
    setOrderOverride(null)
    if (drag.moved) await saveModules(next)
  }
  const moveDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current
    if (!drag) return
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-module-id]')?.dataset.moduleId
    if (!target || target === drag.id) return
    const ids = ordered.map(module => module.id)
    const from = ids.indexOf(drag.id)
    const to = ids.indexOf(target)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, drag.id)
    drag.moved = true
    setOrderOverride(ids)
  }

  if (people.loading && !isNew) return <div className="p-6 text-sm text-[var(--color-text-tertiary)]">读取协作者…</div>
  if (!person) return <div className="p-6"><SubpageBackButton label="返回聊天" href="/cc" /><p className="mt-6 text-sm">找不到这个协作者。</p></div>

  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-3 text-[var(--color-text-primary)]">
    <SubpageBackButton label="返回" href={isNew ? '/cc' : '/'} />
    <header className="flex flex-col items-center pb-3 pt-2 text-center">
      <span className="flex size-[76px] items-center justify-center rounded-full font-[family-name:var(--font-display)] text-3xl font-semibold text-[var(--color-on-primary)] shadow-[var(--glass-shadow)]" style={{ background: person.tint }}>{person.initial || person.name.slice(0, 1)}</span>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[0.1em] text-[var(--color-text-heading)]">{person.name}</h1>
      <p className="mt-1 line-clamp-2 max-w-64 text-xs leading-relaxed text-[var(--color-text-tertiary)]">{person.purpose}</p>
    </header>
    <Section title="Identity · 身份" />
    <div className="prompt-group">
      {FIELDS.map(({ key, label }) => <button key={key} type="button" onClick={() => openField(key)} className="prompt-row flex w-full items-center gap-3 px-4 py-3 text-left text-note">
        <span className="w-16 shrink-0 text-[var(--color-text-tertiary)]">{label}</span>
        <span className="min-w-0 flex-1 truncate text-right">{person[key] || '未设置'}{key === 'initial' && <i className="ml-1.5 inline-block size-3 rounded-full align-middle" style={{ background: person.tint }} />}</span>
        <span className="text-[var(--color-text-disabled)]">›</span>
      </button>)}
    </div>
    {isNew && <button type="button" onClick={() => void persist(person)} disabled={people.saving} className="mt-4 w-full rounded-full bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-on-primary)] disabled:opacity-50">保存新协作者</button>}
    {!isNew && <>
      <Section title="Prompt · 基础提示词" />
      <button type="button" onClick={() => router.push(`/collaborators/${encodeURIComponent(id)}/base`)} className="prompt-group w-full px-4 py-3 text-left">
        <span className="block overflow-hidden whitespace-pre-line text-note leading-relaxed text-[var(--color-text-secondary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5]">{person.basePrompt || '尚未设置基础提示词'}</span>
        <span className="mt-3 flex justify-between text-meta text-[var(--color-text-tertiary)]"><span>{promptSize(person.basePrompt)}</span><span>编辑 ›</span></span>
      </button>
      <Section title="Modules · 提示词模块" action={<button type="button" disabled={people.saving} onClick={() => void addModule()} className="text-xs text-[var(--color-primary)] disabled:opacity-50">＋ 新增</button>} />
      <div className="prompt-group">
        {ordered.length === 0 && <p className="px-4 py-4 text-note text-[var(--color-text-tertiary)]">暂无模块</p>}
        {ordered.map(module => <div key={module.id} data-module-id={module.id} className={`prompt-row flex select-none items-center gap-3 px-4 py-2.5 [-webkit-touch-callout:none] transition-transform motion-reduce:transition-none ${dragId === module.id ? 'scale-[1.02] shadow-[var(--glass-shadow)]' : ''}`}>
          <button type="button" aria-label={`拖动排序 ${module.name}`} className="-my-2 -ml-2 cursor-grab touch-none select-none px-2 py-3 text-sm tracking-[-0.15em] text-[var(--color-text-disabled)] [-webkit-touch-callout:none] active:cursor-grabbing" onContextMenu={event => event.preventDefault()} onPointerDown={event => { event.preventDefault(); dragRef.current = { id: module.id, moved: false }; setDragId(module.id); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => moveDrag(event.clientX, event.clientY)} onPointerUp={() => void finishDrag()} onPointerCancel={() => { dragRef.current = null; setDragId(null); setOrderOverride(null) }}>⋮⋮</button>
          <button type="button" onClick={() => router.push(`/collaborators/${encodeURIComponent(id)}/modules/${encodeURIComponent(module.id)}`)} className="min-w-0 flex-1 text-left">
            <span className="block truncate font-[family-name:var(--font-display)] text-note font-semibold">{module.name}</span><span className="block text-2xs text-[var(--color-text-tertiary)]">{promptSize(module.content)}</span>
          </button>
          <button type="button" role="switch" aria-label={`${module.name}新窗口默认开启`} aria-checked={module.enabledByDefault} onClick={() => void saveModules(modules.map(item => item.id === module.id ? { ...item, enabledByDefault: !item.enabledByDefault } : item))} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${module.enabledByDefault ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-surface-tertiary)]'}`}><span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-[var(--color-on-primary)] shadow-sm transition-transform ${module.enabledByDefault ? 'translate-x-4' : ''}`} /></button>
        </div>)}
      </div>
      <p className="px-1 pt-2 text-2xs leading-relaxed text-[var(--color-text-tertiary)]">开关 = 新窗口默认带上这个模块。按住左边 ⋮⋮ 拖动排序。</p>
      {people.personas.length > 1 && <button type="button" onClick={async () => { if (!window.confirm('确定删除这个协作者？')) return; const result = await people.deletePersona(person.id); if (result.ok) router.replace('/cc') }} className="mt-8 w-full py-3 text-center text-note text-[var(--color-danger)]">删除这个协作者</button>}
    </>}
    {hint && <p role="alert" className="mt-3 text-center text-xs text-[var(--color-danger)]">{hint}</p>}
    <DetailPanel open={field !== null} onClose={() => setField(null)} mode="modal">
      <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold">编辑{FIELDS.find(item => item.key === field)?.label}</h2>
      {field === 'purpose' ? <textarea value={fieldValue} onChange={event => setFieldValue(event.target.value)} className="cc-input h-[50dvh] w-full resize-none leading-relaxed" /> : <input value={fieldValue} onChange={event => setFieldValue(event.target.value)} maxLength={field === 'initial' ? 2 : undefined} className="cc-input w-full" />}
      {field === 'initial' && <div className="mt-4 flex flex-wrap gap-2">{TINT_PRESETS.map(option => <button key={option.id} type="button" onClick={() => setTint(option.value)} aria-label={option.label} aria-pressed={tint === option.value} className={`size-8 rounded-full ${tint === option.value ? 'ring-2 ring-[var(--color-primary)] ring-offset-2' : ''}`} style={{ background: option.value }} />)}</div>}
      <button type="button" onClick={() => void saveField()} disabled={people.saving} className="mt-5 w-full rounded-full bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-on-primary)] disabled:opacity-50">保存</button>
    </DetailPanel>
  </main>
}

function Section({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="flex items-center justify-between px-1 pb-2 pt-5"><h2 className="text-3xs font-semibold uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">{title}</h2>{action}</div>
}
