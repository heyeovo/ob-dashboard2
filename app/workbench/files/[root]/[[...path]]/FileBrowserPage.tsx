'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CcMarkdown from '@/app/cc/CcMarkdown'
import DetailPanel from '@/app/components/DetailPanel'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { WorkbenchIcon, type WorkbenchIconName } from '@/app/workbench/WorkbenchIcon'

type Entry = { name: string; displayName?: string; kind: 'dir' | 'file'; size: number; mtime: string; count?: number }
type Folder = { ok: true; kind: 'dir'; name: string; entries: Entry[] }
type FileInfo = { ok: true; kind: 'file'; name: string; size: number; mtime: string; mime: string; text?: string; truncated: boolean; serverPath: string }
type BrowserData = Folder | FileInfo
type Upload = { name: string; progress: number; state: 'sending' | 'done' | 'error'; error?: string }
const ROOT_NAMES: Record<string, string> = { yanzhi: '言之的文件', dashboard: 'dashboard', haven: 'haven', notes: '言之的笔记' }

function fileHref(root: string, parts: string[]) { return `/workbench/files/${encodeURIComponent(root)}${parts.map(item => `/${encodeURIComponent(item)}`).join('')}` }
function apiHref(root: string, parts: string[], extra = '') { return `/api/files?root=${encodeURIComponent(root)}&path=${encodeURIComponent(parts.join('/'))}${extra}` }
function sizeLabel(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB` }
function dateLabel(value: string) { return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function iconFor(entry: Entry): WorkbenchIconName { if (entry.kind === 'dir') return 'folder'; if (/\.(md|txt)$/i.test(entry.name)) return 'note'; if (/\.(ts|tsx|js|jsx|py|css|json|csv|yaml|yml|sh)$/i.test(entry.name)) return 'code'; if (/\.(html|svg)$/i.test(entry.name)) return 'page'; return 'file' }

export default function FileBrowserPage({ root, parts }: { root: string; parts: string[] }) {
  const router = useRouter()
  const [data, setData] = useState<BrowserData | null>(null)
  const [error, setError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [source, setSource] = useState(false)
  const relative = parts.join('/')
  const back = parts.length ? fileHref(root, parts.slice(0, -1)) : '/workbench'
  const load = useCallback(async () => {
    try {
      const response = await fetch(apiHref(root, parts), { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error || '读取失败')
      setData(body)
      setError('')
    } catch (cause) { setData(null); setError((cause as Error).message) }
  }, [root, relative]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const upload = async (files: FileList | null) => {
    if (!files) return
    const list = Array.from(files)
    setUploads(list.map(file => ({ name: file.name, progress: 0, state: 'sending' })))
    for (let index = 0; index < list.length; index++) {
      const file = list[index]
      await new Promise<void>(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', apiHref(root, parts))
        xhr.upload.onprogress = event => { if (event.lengthComputable) setUploads(previous => previous.map((item, i) => i === index ? { ...item, progress: Math.round(event.loaded / event.total * 100) } : item)) }
        xhr.onload = () => {
          let result: { results?: { ok: boolean; error?: string }[]; error?: string } = {}
          try { result = JSON.parse(xhr.responseText) } catch { /* network response was not JSON */ }
          const failure = result.results?.[0]?.error || result.error || '上传失败'
          const ok = xhr.status >= 200 && xhr.status < 300 && result.results?.[0]?.ok
          setUploads(previous => previous.map((item, i) => i === index ? { ...item, state: ok ? 'done' : 'error', progress: ok ? 100 : item.progress, error: ok ? undefined : failure } : item))
          resolve()
        }
        xhr.onerror = () => { setUploads(previous => previous.map((item, i) => i === index ? { ...item, state: 'error', error: '网络连接失败' } : item)); resolve() }
        const form = new FormData(); form.append('files', file); xhr.send(form)
      })
    }
    await load()
  }
  const remove = async () => {
    if (!confirm(`确定删除「${data?.name}」？`)) return
    const response = await fetch(apiHref(root, parts), { method: 'DELETE' })
    if (response.ok) router.replace(back)
    else { const body = await response.json(); setError(body.error || '删除失败') }
  }
  const groups = data?.kind === 'dir' ? [data.entries.filter(entry => entry.kind === 'dir'), data.entries.filter(entry => entry.kind === 'file')] : []
  const isMarkdown = data?.kind === 'file' && /\.md$/i.test(data.name)
  const isImage = data?.kind === 'file' && data.mime.startsWith('image/')
  const isPdf = data?.kind === 'file' && data.mime === 'application/pdf'
  const canOpen = root === 'yanzhi' && parts[0] === 'artifacts' && parts.length === 2 && /\.(html|svg)$/i.test(parts[1])

  return <main className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-3 text-[var(--color-text-primary)]">
    <div className="flex items-center justify-between"><SubpageBackButton label="返回上一层" href={back} />
      <div className="flex items-center gap-2">{data?.kind === 'dir' && root === 'yanzhi' && <button type="button" onClick={() => { setUploads([]); setUploadOpen(true) }} className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-note font-semibold text-[var(--color-on-primary)]">＋ 放进来</button>}
      {data?.kind === 'file' && <><a href={apiHref(root, parts, '&raw=1&download=1')} aria-label="下载文件" className="subpage-back-button inline-flex items-center justify-center">↓</a><div className="relative"><button type="button" aria-label="更多操作" onClick={() => setMenuOpen(!menuOpen)} className="subpage-back-button inline-flex items-center justify-center">···</button>{menuOpen && <div className="float-surface absolute right-0 top-11 z-50 min-w-32 overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-md)]"><button type="button" onClick={() => { void navigator.clipboard.writeText(data.serverPath).then(() => setMenuOpen(false)).catch(() => setError('复制路径失败')) }} className="block w-full px-4 py-3 text-left text-note">复制路径</button>{root === 'yanzhi' && <button type="button" onClick={() => { setMenuOpen(false); void remove() }} className="block w-full px-4 py-3 text-left text-note text-[var(--color-danger)]">删除</button>}</div>}</div></>}</div>
    </div>
    <p className="mt-3 px-1 text-2xs text-[var(--color-text-tertiary)]">{ROOT_NAMES[root] || root} / {parts.slice(0, -1).map(item => `${root === 'notes' ? item.replace(/^-workspace-/, '') : item} / `)}</p>
    <h1 className="mt-1 px-1 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-wide">{data?.name || (parts.at(-1) || ROOT_NAMES[root] || '文件')}</h1>
    {data?.kind === 'dir' && <p className="px-1 text-xs text-[var(--color-text-tertiary)]">{groups[0].length} 个文件夹 · {groups[1].length} 个文件</p>}
    {data?.kind === 'file' && <p className="px-1 text-xs text-[var(--color-text-tertiary)]">{sizeLabel(data.size)} · {dateLabel(data.mtime)}</p>}
    {error && <p role="alert" className="mt-6 text-note text-[var(--color-danger)]">{error}</p>}
    {!data && !error && <p className="mt-6 text-note text-[var(--color-text-tertiary)]">正在读取…</p>}
    {data?.kind === 'dir' && <div className="mt-5 space-y-2.5">{groups.map((group, index) => group.length > 0 && <div key={index} className="prompt-group">{group.map(entry => <Link key={entry.name} href={fileHref(root, [...parts, entry.name])} className="prompt-row flex min-h-13 items-center gap-3 px-4 py-2"><WorkbenchIcon name={iconFor(entry)} primary={root === 'yanzhi' && entry.kind === 'dir'} /><span className="min-w-0 flex-1"><span className="block truncate text-note">{entry.displayName || entry.name}</span><span className="block text-2xs text-[var(--color-text-tertiary)]">{entry.kind === 'dir' ? `${entry.count ?? 0} 项` : `${sizeLabel(entry.size)} · ${dateLabel(entry.mtime)}`}</span></span><span className="text-[var(--color-text-disabled)]">›</span></Link>)}</div>)}{data.entries.length === 0 && <p className="pt-5 text-center text-note text-[var(--color-text-tertiary)]">这里还是空的</p>}</div>}
    {data?.kind === 'file' && <div className="mt-5">{canOpen && <Link href={`/artifacts/${encodeURIComponent(data.name)}`} className="mb-4 inline-block rounded-full bg-[var(--color-primary)] px-4 py-2 text-note text-[var(--color-on-primary)]">打开</Link>}
      {isMarkdown && <div className="mb-3 inline-flex gap-1 rounded-full bg-[var(--color-surface-tertiary)] p-1 text-xs"><button type="button" onClick={() => setSource(false)} className={`rounded-full px-3 py-1 ${!source ? 'bg-[var(--color-surface)] shadow-[var(--shadow-sm)]' : ''}`}>预览</button><button type="button" onClick={() => setSource(true)} className={`rounded-full px-3 py-1 ${source ? 'bg-[var(--color-surface)] shadow-[var(--shadow-sm)]' : ''}`}>原文</button></div>}
      {data.text !== undefined ? <div className="overflow-x-auto rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)]">{isMarkdown && !source ? <CcMarkdown text={data.text} /> : <div className="min-w-max font-mono text-note leading-relaxed">{data.text.split('\n').map((line, index) => <div key={index} className="flex gap-4 whitespace-pre"><span className="w-8 shrink-0 select-none text-right text-[var(--color-text-disabled)]">{index + 1}</span><span>{line || ' '}</span></div>)}</div>}</div> : isImage ? <img src={apiHref(root, parts, '&raw=1')} alt={data.name} className="max-w-full rounded-[var(--radius-xl)]" /> : isPdf ? <iframe src={apiHref(root, parts, '&raw=1')} title={data.name} className="h-[70vh] w-full rounded-[var(--radius-xl)] bg-[var(--color-surface)]" /> : <p className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-5 text-note text-[var(--color-text-tertiary)]">这个类型看不了，可以下载</p>}
      {data.truncated && <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">只显示了前面一段，完整的下载看</p>}
    </div>}
    <DetailPanel open={uploadOpen} onClose={() => setUploadOpen(false)} mode="drawer" className="px-5 pb-8"><h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">放进来</h2><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">放到：{ROOT_NAMES[root]} / {parts.length ? parts.join(' / ') : '小羊给的'}</p><label className="mt-5 block cursor-pointer rounded-[var(--radius-xl)] border border-dashed border-[var(--color-primary)] px-4 py-5 text-center text-note text-[var(--color-primary)]">选文件<input type="file" multiple className="sr-only" onChange={event => void upload(event.target.files)} /><span className="mt-1 block text-2xs text-[var(--color-text-tertiary)]">照片、拍照、文件 App 都行 · 单个不超过 10 MB</span></label>{uploads.map((item, index) => <div key={`${item.name}-${index}`} className="mt-3 text-note"><div className="flex justify-between gap-2"><span className="truncate">{item.name}</span><span className={item.state === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-primary)]'}>{item.state === 'done' ? '已放好' : item.state === 'error' ? item.error : `${item.progress}%`}</span></div><div className="mt-1 h-1 rounded-full bg-[var(--color-surface-tertiary)]"><div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${item.progress}%` }} /></div></div>)}<p className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] p-3 text-2xs leading-relaxed text-[var(--color-text-tertiary)]">文本文件（md、txt、csv、json、代码）闲聊里的言之能直接搜、按段读。图片和 PDF 现在只有工作窗口的言之能看。同名文件会自动加个 (2)，不会覆盖。</p></DetailPanel>
  </main>
}
