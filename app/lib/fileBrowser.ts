import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { YANZHI_FILES_ROOT } from '@/app/lib/artifactMeta'

export type FileRoot = 'yanzhi' | 'dashboard' | 'haven' | 'notes'
export const ROOT_NAMES: Record<FileRoot, string> = {
  yanzhi: '言之的文件', dashboard: 'dashboard', haven: 'haven', notes: '言之的笔记',
}
export const ROOT_PATHS: Record<Exclude<FileRoot, 'notes'>, string> = {
  yanzhi: YANZHI_FILES_ROOT, dashboard: '/workspace/dashboard', haven: '/workspace/haven',
}
export const NOTES_PROJECTS = '/home/cc/.claude/projects'
export const TEXT_LIMIT = 256 * 1024
export const UPLOAD_LIMIT = 10 * 1024 * 1024

export function isFileRoot(value: string): value is FileRoot {
  return value === 'yanzhi' || value === 'dashboard' || value === 'haven' || value === 'notes'
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export async function resolveExistingInside(root: string, relative: string): Promise<string | null> {
  const parts = safeSegments(relative)
  if (!parts) return null
  const target = await realpath(path.join(root, ...parts)).catch(() => null)
  // Check resolved segments too: an innocently named link must not expose .room or darkroom.
  const resolvedParts = target ? safeSegments(path.relative(root, target).split(path.sep).join('/')) : null
  return target && isInside(root, target) && resolvedParts ? target : null
}

export function isBlockedSegment(name: string): boolean {
  const lower = name.toLowerCase()
  return !name || name === '..' || name.startsWith('.') || lower === 'node_modules' || lower === 'darkroom'
    || /\.(pem|key)$/i.test(name) || /credential|secret/i.test(name)
}

export function safeSegments(relative: string): string[] | null {
  if (path.isAbsolute(relative) || relative.startsWith('/') || relative.startsWith('\\') || /[\\\0]/.test(relative)) return null
  const parts = relative.split('/').filter(Boolean)
  return parts.some(isBlockedSegment) ? null : parts
}

export function cleanUploadName(input: string): string {
  const basename = input.replaceAll('\\', '/').split('/').pop() || ''
  return basename.replace(/^\.+/, '').replace(/[\/\0-\x1f]/g, '').trim()
}

export function numberedName(name: string, index: number): string {
  if (index <= 1) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return `${stem} (${index})${dot > 0 ? name.slice(dot) : ''}`
}

export function mimeType(name: string): string {
  const extension = name.toLowerCase().split('.').pop()
  const types: Record<string, string> = {
    md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf',
    ts: 'text/plain; charset=utf-8', tsx: 'text/plain; charset=utf-8', js: 'text/plain; charset=utf-8',
    jsx: 'text/plain; charset=utf-8', css: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8',
    sh: 'text/plain; charset=utf-8', yaml: 'text/plain; charset=utf-8', yml: 'text/plain; charset=utf-8',
    xml: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', sql: 'text/plain; charset=utf-8',
  }
  return types[extension || ''] || 'application/octet-stream'
}

export function isTextFile(name: string): boolean {
  const mime = mimeType(name)
  return mime.startsWith('text/') || mime.startsWith('application/json')
}
