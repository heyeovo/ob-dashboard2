'use client'

import { useState } from 'react'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { usePersonas } from '@/app/cc/usePersonas'

export default function WorkbenchDirsPage() {
  const people = usePersonas()
  const person = people.active
  const [dirInput, setDirInput] = useState('')
  const [writeDirInput, setWriteDirInput] = useState('')
  const [hint, setHint] = useState('')

  const persist = async (key: 'dirs' | 'writeDirs', values: string[]) => {
    const result = await people.savePersona({ ...person, [key]: values })
    setHint(result.ok ? '已保存' : result.error || '保存失败')
  }
  const saveDirs = async (key: 'dirs' | 'writeDirs', text: string) => {
    if (!text.trim()) return
    await persist(key, [...new Set([...person[key], text.trim()])])
    if (key === 'dirs') setDirInput('')
    else setWriteDirInput('')
  }
  const removeDir = async (key: 'dirs' | 'writeDirs', value: string) => {
    await persist(key, person[key].filter(item => item !== value))
  }

  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-3 text-[var(--color-text-primary)]">
    <SubpageBackButton label="返回工作台" href="/workbench" />
    <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold">目录权限</h1>
    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
      <span>{person.name} 的目录</span>
      {people.personas.length > 1 && <select aria-label="协作者" value={person.id} onChange={event => { people.selectPersona(event.target.value); setHint('') }} className="rounded-[var(--radius-md)] bg-[var(--color-surface)] px-2 py-1 text-note text-[var(--color-text-primary)]">{people.personas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    </div>
    {people.loading ? <p className="mt-5 text-note text-[var(--color-text-tertiary)]">读取协作者…</p> : <div className="prompt-group mt-5 space-y-5 px-4 py-4">
      {([{ key: 'dirs', title: '能访问的目录', hint: '一行一个绝对路径。第一个当工作目录；留空只能读看板仓库。', value: dirInput, set: setDirInput }, { key: 'writeDirs', title: '能修改的目录', hint: '留空 = 一个文件都不能改。只填现在正在做的项目。', value: writeDirInput, set: setWriteDirInput }] as const).map(group => <div key={group.key}>
        <h2 className="mb-1 text-xs text-[var(--color-text-tertiary)]">{group.title}</h2><p className="mb-2 text-meta text-[var(--color-text-tertiary)]">{group.hint}</p>
        {person[group.key].map(path => <div key={path} className="flex items-center justify-between gap-2 py-1 text-note"><span className="min-w-0 break-all font-mono">{path}</span><button type="button" disabled={people.saving} onClick={() => void removeDir(group.key, path)} className="text-[var(--color-danger)] disabled:opacity-50">移除</button></div>)}
        <div className="mt-2 flex gap-2"><input value={group.value} onChange={event => group.set(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveDirs(group.key, group.value) } }} className="cc-input min-w-0 flex-1 font-mono" placeholder="输入绝对路径" /><button type="button" disabled={people.saving} onClick={() => void saveDirs(group.key, group.value)} className="text-xs text-[var(--color-primary)] disabled:opacity-50">添加</button></div>
      </div>)}
    </div>}
    {hint && <p role="status" className="mt-3 text-xs text-[var(--color-text-tertiary)]">{hint}</p>}
  </main>
}
