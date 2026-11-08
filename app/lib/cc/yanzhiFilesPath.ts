import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

function cleanRelativePath(value: string | undefined, allowRoot = false): string {
  const raw = String(value || '').trim().replaceAll('\\', '/')
  if (!raw || raw === '.') {
    if (allowRoot) return ''
    throw new Error('path 必填。')
  }
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) throw new Error('path 必须是专用目录内的相对路径。')
  const parts = raw.split('/').filter(Boolean)
  if (parts.some(part => part === '..')) throw new Error('path 不能包含 ..。')
  return parts.filter(part => part !== '.').join('/')
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function existingRoot(root: string): Promise<string> {
  let info
  try {
    info = await stat(root)
  } catch {
    throw new Error(`yanzhi's files 尚未挂载：${root}`)
  }
  if (!info.isDirectory()) throw new Error(`yanzhi's files 根路径不是目录：${root}`)
  return realpath(root)
}

export async function safeTarget(root: string, value: string | undefined, options: { allowRoot?: boolean; allowMissing?: boolean } = {}) {
  const relative = cleanRelativePath(value, options.allowRoot)
  const realRoot = await existingRoot(root)
  const target = path.resolve(realRoot, relative)
  if (!inside(realRoot, target)) throw new Error('path 超出 yanzhi\'s files 根目录。')

  let current = realRoot
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error('path 不能经过符号链接。')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.allowMissing) break
      throw error
    }
  }
  return { relative, target }
}
