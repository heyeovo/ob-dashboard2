'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePersonas } from '@/app/cc/usePersonas'
import { WorkbenchIcon, type WorkbenchIconName } from './WorkbenchIcon'

type Artifact = { name: string; title: string; updated_at: string }
type RootInfo = { key: string; available: boolean; count?: number }
type Entry = { label: string; description: string; href: string; icon: WorkbenchIconName; primary?: boolean; root?: string }

const FILES: Entry[] = [
  { label: '言之的文件', description: '作品、你放进来的东西', href: '/workbench/files/yanzhi', icon: 'folder', primary: true, root: 'yanzhi' },
  { label: 'dashboard', description: '前端仓库 · 只读', href: '/workbench/files/dashboard', icon: 'folder', root: 'dashboard' },
  { label: 'haven', description: '记忆后端仓库 · 只读', href: '/workbench/files/haven', icon: 'folder', root: 'haven' },
  { label: '言之的笔记', description: 'Claude Code 里的工作笔记 · 只读', href: '/workbench/files/notes', icon: 'note', root: 'notes' },
]
const ENGINE: Entry[] = [
  { label: '跑团', description: '调查员、线索与桌边话', href: '/trpg', icon: 'note' },
  { label: '工具 · MCP', description: '工具清单与 MCP 服务', href: '/tools/mcp', icon: 'plug' },
  { label: '模拟 Breath', description: 'Pipeline、即时模拟、评分旋钮', href: '/breath-sim', icon: 'wave' },
  { label: '召回透镜', description: '逐轮看召回、拒绝与降级', href: '/recall-lens', icon: 'lens' },
  { label: '聊天切片', description: '按日期检查离线切片', href: '/conversation-slices', icon: 'slice' },
  { label: '上下文审计', description: '这一轮到底带了什么进去', href: '/workbench/context', icon: 'layers' },
  { label: '当前工作窗口', description: '待批准、改过的文件、回退点、命令输出', href: '/workbench/session', icon: 'now' },
]

function Section({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between px-1 pb-2 pt-5"><h2 className="text-3xs font-semibold uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">{title}</h2>{action}</div>
}

function Row({ entry, status }: { entry: Entry; status?: string }) {
  const unavailable = status === '这台机器上没有'
  const content = <><WorkbenchIcon name={entry.icon} primary={entry.primary} /><span className="min-w-0 flex-1"><span className="block truncate text-note">{entry.label}</span><span className="block truncate text-2xs text-[var(--color-text-tertiary)]">{entry.description}</span></span>{status && <span className="shrink-0 text-2xs text-[var(--color-text-tertiary)]">{status}</span>}<span aria-hidden="true" className="text-[var(--color-text-disabled)]">›</span></>
  return unavailable
    ? <div className="prompt-row flex min-h-13 items-center gap-3 px-4 py-2 opacity-60">{content}</div>
    : <Link href={entry.href} className="prompt-row flex min-h-13 items-center gap-3 px-4 py-2">{content}</Link>
}

// 跨切页缓存：回到工作台先用上次的结果画出来，后台再刷新，作品行不再晚一拍冒出来把下面顶下去
let artifactsCache: Artifact[] | null = null
let rootsCache: RootInfo[] = []

export default function WorkbenchPage() {
  const people = usePersonas()
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(artifactsCache)
  const [roots, setRoots] = useState<RootInfo[]>(rootsCache)
  useEffect(() => {
    void fetch('/api/artifacts').then(r => r.json()).then(data => { artifactsCache = data.ok ? data.items.slice(0, 8) : []; setArtifacts(artifactsCache) }).catch(() => { artifactsCache = artifactsCache || []; setArtifacts(artifactsCache) })
    void fetch('/api/files?root=all').then(r => r.json()).then(data => { if (data.ok) { rootsCache = data.roots; setRoots(rootsCache) } }).catch(() => {})
  }, [])
  const rootStatus = (key: string) => {
    const root = roots.find(item => item.key === key)
    return root ? root.available ? key === 'yanzhi' ? `${root.count ?? 0} 项` : undefined : '这台机器上没有' : undefined
  }
  return <div className="mobile-page-with-topbar min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
    <header className="mobile-page-topbar flex items-center px-3 md:hidden"><span className="text-xl font-semibold" style={{ fontFamily: 'var(--font-display)' }}>工作台</span></header>
    <main className="mx-auto max-w-2xl px-3 pt-5 sm:px-6 sm:pt-10">
      <h1 className="mb-6 hidden text-3xl font-bold tracking-tight text-[var(--color-text-heading)] md:block">工作台</h1>
      {(artifacts === null || artifacts.length > 0) && <section><Section title="Works · 作品" action={<Link href="/workbench/files/yanzhi/artifacts" className="text-xs text-[var(--color-primary)]">全部 ›</Link>} /><div className="-mx-3 flex gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">{artifacts === null ? [0, 1, 2].map(index => <div key={index} aria-hidden="true" className="w-[132px] shrink-0 overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-surface)] opacity-60"><div className="h-[74px]" /><div className="px-2.5 pt-2 text-xs">&nbsp;</div><div className="px-2.5 pb-2 pt-0.5 text-3xs">&nbsp;</div></div>) : artifacts.map((item, index) => <Link key={item.name} href={`/artifacts/${encodeURIComponent(item.name)}`} className="w-[132px] shrink-0 overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"><div className="relative h-[74px] bg-[image:var(--theme-mesh)] bg-[length:160%_160%]" style={{ backgroundPosition: `${index * 19 % 100}% ${index * 27 % 100}%` }}><span className="absolute bottom-1.5 right-2 max-w-[110px] truncate font-[family-name:var(--font-display)] text-xs italic text-[var(--color-text-heading)]">{item.name.replace(/\.(html|svg)$/i, '')}</span></div><div className="truncate px-2.5 pt-2 font-[family-name:var(--font-display)] text-xs font-semibold">{item.title}</div><div className="px-2.5 pb-2 pt-0.5 text-3xs text-[var(--color-text-tertiary)]">{new Date(item.updated_at).toLocaleDateString('zh-CN')}</div></Link>)}</div></section>}
      <section><Section title="Files · 文件" /><div className="prompt-group">{FILES.map(entry => <Row key={entry.href} entry={entry} status={rootStatus(entry.root!)} />)}</div><div className="prompt-group mt-2.5"><Row entry={{ label: '目录权限', description: `能访问 ${people.active.dirs.length} 个 · 能修改 ${people.active.writeDirs.length} 个`, href: '/workbench/dirs', icon: 'lock' }} /></div></section>
      <section><Section title="Engine · 引擎" /><div className="prompt-group">{ENGINE.map(entry => <Row key={entry.href} entry={entry} />)}</div></section>
    </main>
  </div>
}
