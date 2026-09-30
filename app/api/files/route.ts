import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, realpath, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { NextRequest } from 'next/server'
import {
  cleanUploadName, isBlockedSegment, isFileRoot, isInside, isTextFile, mimeType, resolveExistingInside,
  NOTES_PROJECTS, numberedName, ROOT_NAMES, ROOT_PATHS, safeSegments, TEXT_LIMIT, UPLOAD_LIMIT,
  type FileRoot,
} from '@/app/lib/fileBrowser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Entry = { name: string; displayName?: string; kind: 'dir' | 'file'; size: number; mtime: string; count?: number }
const noStore = { 'Cache-Control': 'no-store' }
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers: noStore })

async function existingRoot(root: Exclude<FileRoot, 'notes'>): Promise<string | null> {
  const lexical = path.resolve(ROOT_PATHS[root])
  try {
    const actual = await realpath(lexical)
    return actual === lexical && (await stat(actual)).isDirectory() ? actual : null
  } catch { return null }
}

async function notesProjects(): Promise<Entry[]> {
  let projectsRoot: string
  try {
    projectsRoot = await realpath(NOTES_PROJECTS)
    if (projectsRoot !== path.resolve(NOTES_PROJECTS)) return []
  } catch { return [] }
  const dirs = await readdir(projectsRoot, { withFileTypes: true })
  const items = await Promise.all(dirs.filter(item => item.isDirectory() && !item.isSymbolicLink() && !isBlockedSegment(item.name)).map(async item => {
    const memory = path.join(projectsRoot, item.name, 'memory')
    try {
      const actual = await realpath(memory)
      if (actual !== memory || !(await stat(actual)).isDirectory()) return null
      const visible = (await readdir(actual)).filter(name => !isBlockedSegment(name))
      if (visible.length === 0) return null
      return { name: item.name, displayName: item.name.replace(/^-workspace-/, ''), kind: 'dir' as const, size: 0, mtime: (await stat(actual)).mtime.toISOString(), count: visible.length }
    } catch { return null }
  }))
  return items.filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => a.displayName.localeCompare(b.displayName))
}

async function resolveTarget(root: FileRoot, relative: string): Promise<{ target: string; base: string; parts: string[] } | null> {
  const parts = safeSegments(relative)
  if (!parts) throw new Error('blocked')
  if (root === 'notes') {
    if (parts.length === 0) return null
    const projects = await notesProjects()
    if (!projects.some(item => item.name === parts[0])) return null
    const base = path.join(NOTES_PROJECTS, parts[0], 'memory')
    const target = await resolveExistingInside(base, parts.slice(1).join('/'))
    return target ? { target, base, parts } : null
  }
  const base = await existingRoot(root)
  if (!base) return null
  const target = await resolveExistingInside(base, relative)
  return target ? { target, base, parts } : null
}

async function visibleEntries(dir: string): Promise<Entry[]> {
  const names = (await readdir(dir)).filter(name => !isBlockedSegment(name))
  const entries = await Promise.all(names.map(async name => {
    try {
      const actual = await realpath(path.join(dir, name))
      if (!isInside(dir, actual)) return null
      const info = await stat(actual)
      if (!info.isDirectory() && !info.isFile()) return null
      const kind = info.isDirectory() ? 'dir' as const : 'file' as const
      let count: number | undefined
      if (kind === 'dir') count = (await readdir(actual)).filter(item => !isBlockedSegment(item)).length
      return { name, kind, size: info.size, mtime: info.mtime.toISOString(), count }
    } catch { return null }
  }))
  return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null).sort((a, b) => a.kind === b.kind ? b.mtime.localeCompare(a.mtime) : a.kind === 'dir' ? -1 : 1)
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams
  const rootParam = query.get('root') || ''
  if (rootParam === 'all') {
    const roots = await Promise.all((['yanzhi', 'dashboard', 'haven', 'notes'] as const).map(async key => {
      if (key === 'notes') return { key, available: (await notesProjects()).length > 0 }
      const base = await existingRoot(key)
      return { key, available: Boolean(base), count: base ? (await visibleEntries(base)).length : 0 }
    }))
    return Response.json({ ok: true, roots }, { headers: noStore })
  }
  if (!isFileRoot(rootParam)) return fail(400, '未知文件根目录')
  const relative = query.get('path') || ''
  if (safeSegments(relative) === null) return fail(403, '这个路径不能访问')
  if (rootParam === 'notes' && !relative) {
    const entries = await notesProjects()
    return Response.json({ ok: true, kind: 'dir', name: ROOT_NAMES.notes, entries, serverPath: null }, { headers: noStore })
  }
  const resolved = await resolveTarget(rootParam, relative)
  if (!resolved) return fail(404, '这台机器上没有这个路径')
  const info = await stat(resolved.target)
  if (info.isDirectory()) {
    if (query.has('raw')) return fail(400, '文件夹不能下载')
    const name = resolved.parts.at(-1) || ROOT_NAMES[rootParam]
    return Response.json({ ok: true, kind: 'dir', name: rootParam === 'notes' && resolved.parts.length === 1 ? name.replace(/^-workspace-/, '') : name, entries: await visibleEntries(resolved.target) }, { headers: noStore })
  }
  if (!info.isFile()) return fail(404, '找不到文件')
  const name = path.basename(resolved.target)
  const mime = mimeType(name)
  if (query.get('raw') === '1') {
    const headers = new Headers({ ...noStore, 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' })
    if (query.get('download') === '1') headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    return new Response(Readable.toWeb(createReadStream(resolved.target)) as ReadableStream, { headers })
  }
  let text: string | undefined
  if (isTextFile(name)) {
    const handle = await open(resolved.target, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(info.size, TEXT_LIMIT))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } finally { await handle.close() }
  }
  return Response.json({ ok: true, kind: 'file', name, size: info.size, mtime: info.mtime.toISOString(), mime, text, truncated: Boolean(text !== undefined && info.size > TEXT_LIMIT), serverPath: resolved.target }, { headers: noStore })
}

export async function POST(request: NextRequest) {
  const root = request.nextUrl.searchParams.get('root')
  if (root !== 'yanzhi') return fail(403, '这里只能上传到言之的文件')
  const relative = request.nextUrl.searchParams.get('path') || ''
  if (safeSegments(relative) === null) return fail(403, '这个路径不能访问')
  const base = await existingRoot('yanzhi')
  if (!base) return fail(404, '这台机器上没有言之的文件')
  let targetDir: string
  if (!relative) {
    const inbox = path.join(base, '小羊给的')
    await mkdir(inbox, { recursive: true })
    targetDir = await realpath(inbox)
  } else {
    const resolved = await resolveTarget('yanzhi', relative)
    if (!resolved || !(await stat(resolved.target)).isDirectory()) return fail(404, '目标文件夹不存在')
    targetDir = resolved.target
  }
  if (!isInside(base, targetDir)) return fail(403, '目标文件夹不允许访问')
  const form = await request.formData()
  const files = form.getAll('files').filter((item): item is File => item instanceof File)
  if (!files.length) return fail(400, '没有选择文件')
  const results: { name: string; ok: boolean; error?: string }[] = []
  for (const file of files) {
    const name = cleanUploadName(file.name)
    if (!name || isBlockedSegment(name)) { results.push({ name: file.name, ok: false, error: '文件名不允许' }); continue }
    if (file.size > UPLOAD_LIMIT) { results.push({ name, ok: false, error: '单个文件不能超过 10 MB' }); continue }
    try {
      for (let index = 1; ; index++) {
        const candidate = numberedName(name, index)
        const target = path.join(targetDir, candidate)
        let handle
        try { handle = await open(target, 'wx') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error }
        try { await handle.writeFile(Buffer.from(await file.arrayBuffer())) } finally { await handle.close() }
        results.push({ name: candidate, ok: true })
        break
      }
    } catch (error) { results.push({ name, ok: false, error: (error as Error).message || '上传失败' }) }
  }
  return Response.json({ ok: results.every(item => item.ok), folder: relative || '小羊给的', results }, { headers: noStore })
}

export async function DELETE(request: NextRequest) {
  if (request.nextUrl.searchParams.get('root') !== 'yanzhi') return fail(403, '这里只有言之的文件能删除')
  const relative = request.nextUrl.searchParams.get('path') || ''
  if (!relative || safeSegments(relative) === null) return fail(403, '这个路径不能删除')
  const resolved = await resolveTarget('yanzhi', relative)
  if (!resolved) return fail(404, '找不到文件')
  if (!(await stat(resolved.target)).isFile()) return fail(403, '不能删除文件夹')
  await unlink(resolved.target)
  return Response.json({ ok: true }, { headers: noStore })
}
