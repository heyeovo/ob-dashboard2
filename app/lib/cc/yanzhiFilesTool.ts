import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const YANZHI_FILES_SERVER_NAME = 'yanzhi'
export const YANZHI_FILES_TOOL_NAME = 'files'
export const YANZHI_FILES_MCP_VERSION = '1.0.0'
export const YANZHI_FILES_ROOT = '/data/cc-chat-files'

const MAX_LIST_ENTRIES = 100
const MAX_READ_LINES = 500
const DEFAULT_READ_LINES = 200
const MAX_SEARCH_RESULTS = 50
const DEFAULT_SEARCH_RESULTS = 20
const MAX_SEARCH_FILES = 500
const MAX_TEXT_FILE_BYTES = 1024 * 1024
const MAX_WRITE_BYTES = 256 * 1024

const INPUT = {
  action: z.enum(['list', 'search', 'read', 'write', 'mkdir']),
  path: z.string().optional(),
  query: z.string().optional(),
  content: z.string().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
  overwrite: z.boolean().optional(),
}

export type YanzhiFilesInput = {
  action: 'list' | 'search' | 'read' | 'write' | 'mkdir'
  path?: string
  query?: string
  content?: string
  offset?: number
  limit?: number
  overwrite?: boolean
}

const DESCRIPTION = "Manage text files only inside yanzhi's files. action=list lists one directory; search finds names/text using query; read returns lines using offset/limit; write uses content (existing files require overwrite=true); mkdir creates folders. path is relative to the fixed root; no delete, move, commands, absolute paths, or access outside it."

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

async function safeTarget(root: string, value: string | undefined, options: { allowRoot?: boolean; allowMissing?: boolean } = {}) {
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

function ensureText(buffer: Buffer): string {
  if (buffer.includes(0)) throw new Error('仅支持文本文件。')
  return buffer.toString('utf8')
}

function limited(value: number | undefined, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, Math.floor(value || fallback)))
}

async function listAction(root: string, input: YanzhiFilesInput): Promise<string> {
  const { relative, target } = await safeTarget(root, input.path, { allowRoot: true })
  const entries = await readdir(target, { withFileTypes: true })
  const rows = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_LIST_ENTRIES)
    .map(entry => `${entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'}\t${entry.name}`)
  const suffix = entries.length > MAX_LIST_ENTRIES ? `\n仅显示前 ${MAX_LIST_ENTRIES} 项。` : ''
  return `${relative || '.'}\n${rows.join('\n') || '（空目录）'}${suffix}`
}

async function readAction(root: string, input: YanzhiFilesInput): Promise<string> {
  const { relative, target } = await safeTarget(root, input.path)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('read 只能读取文件。')
  if (info.size > MAX_TEXT_FILE_BYTES) throw new Error('文件超过 1 MB，请先用 search 定位内容。')
  const lines = ensureText(await readFile(target)).split(/\r?\n/)
  const offset = Math.min(lines.length, Math.max(0, Math.floor(input.offset || 0)))
  const limit = limited(input.limit, DEFAULT_READ_LINES, MAX_READ_LINES)
  const body = lines.slice(offset, offset + limit).map((line, index) => `${offset + index + 1}: ${line}`).join('\n')
  return `${relative} · lines ${offset + 1}-${Math.min(lines.length, offset + limit)} / ${lines.length}\n${body}${offset + limit < lines.length ? '\n还有后续，请增加 offset 继续读取。' : ''}`
}

async function searchAction(root: string, input: YanzhiFilesInput): Promise<string> {
  const query = String(input.query || '').trim()
  if (!query) throw new Error('search 必须提供 query。')
  const { relative, target } = await safeTarget(root, input.path, { allowRoot: true })
  const limit = limited(input.limit, DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS)
  const needle = query.toLocaleLowerCase()
  const results: string[] = []
  let filesSeen = 0

  async function walk(directory: string, prefix: string): Promise<void> {
    if (results.length >= limit || filesSeen >= MAX_SEARCH_FILES) return
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (results.length >= limit || filesSeen >= MAX_SEARCH_FILES) return
      if (entry.isSymbolicLink()) continue
      const child = path.join(directory, entry.name)
      const childRelative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(child, childRelative)
        continue
      }
      if (!entry.isFile()) continue
      filesSeen += 1
      const displayPath = relative ? `${relative}/${childRelative}` : childRelative
      if (entry.name.toLocaleLowerCase().includes(needle)) results.push(`${displayPath}:name`)
      if (results.length >= limit) return
      const info = await stat(child)
      if (info.size > MAX_TEXT_FILE_BYTES) continue
      const buffer = await readFile(child)
      if (buffer.includes(0)) continue
      const lines = buffer.toString('utf8').split(/\r?\n/)
      for (let index = 0; index < lines.length && results.length < limit; index += 1) {
        if (lines[index].toLocaleLowerCase().includes(needle)) {
          results.push(`${displayPath}:${index + 1}: ${lines[index].slice(0, 240)}`)
        }
      }
    }
  }

  const targetInfo = await stat(target)
  if (targetInfo.isFile()) {
    filesSeen = 1
    if (targetInfo.size > MAX_TEXT_FILE_BYTES) return '未找到匹配内容。'
    const buffer = await readFile(target)
    const text = ensureText(buffer)
    text.split(/\r?\n/).forEach((line, index) => {
      if (results.length < limit && line.toLocaleLowerCase().includes(needle)) results.push(`${relative}:${index + 1}: ${line.slice(0, 240)}`)
    })
  } else if (targetInfo.isDirectory()) {
    await walk(target, '')
  } else {
    throw new Error('search path 必须是文件或目录。')
  }
  return results.length ? results.join('\n') : '未找到匹配内容。'
}

async function writeAction(root: string, input: YanzhiFilesInput): Promise<string> {
  if (input.content === undefined) throw new Error('write 必须提供 content。')
  if (Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) throw new Error('单次写入不能超过 256 KB。')
  const { relative, target } = await safeTarget(root, input.path, { allowMissing: true })
  const parent = path.dirname(target)
  const parentInfo = await stat(parent).catch(() => null)
  if (!parentInfo?.isDirectory()) throw new Error('父目录不存在，请先用 mkdir 创建。')
  await safeTarget(root, path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative), { allowRoot: true })
  await writeFile(target, input.content, { encoding: 'utf8', flag: input.overwrite ? 'w' : 'wx' })
  return `已写入 ${relative}（${Buffer.byteLength(input.content, 'utf8')} bytes）。`
}

async function mkdirAction(root: string, input: YanzhiFilesInput): Promise<string> {
  const { relative, target } = await safeTarget(root, input.path, { allowMissing: true })
  await mkdir(target, { recursive: true })
  await safeTarget(root, relative)
  return `已创建目录 ${relative}。`
}

export async function executeYanzhiFiles(input: YanzhiFilesInput, root = YANZHI_FILES_ROOT): Promise<string> {
  if (input.action === 'list') return listAction(root, input)
  if (input.action === 'search') return searchAction(root, input)
  if (input.action === 'read') return readAction(root, input)
  if (input.action === 'write') return writeAction(root, input)
  return mkdirAction(root, input)
}

export function yanzhiFilesMcpModelSurface() {
  return {
    name: YANZHI_FILES_SERVER_NAME,
    version: YANZHI_FILES_MCP_VERSION,
    alwaysLoad: true,
    tools: [{
      name: YANZHI_FILES_TOOL_NAME,
      description: DESCRIPTION,
      alwaysLoad: true,
      inputSchema: z.toJSONSchema(z.object(INPUT)),
    }],
  }
}

export function createYanzhiFilesMcpServer(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: YANZHI_FILES_SERVER_NAME,
    version: YANZHI_FILES_MCP_VERSION,
    alwaysLoad: true,
    tools: [tool(
      YANZHI_FILES_TOOL_NAME,
      DESCRIPTION,
      INPUT,
      async args => {
        try {
          return { content: [{ type: 'text', text: await executeYanzhiFiles(args) }] }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          const message = code === 'EEXIST'
            ? '文件已存在；如果确实要覆盖，请显式设置 overwrite=true。'
            : error instanceof Error ? error.message : '文件操作失败。'
          return { content: [{ type: 'text', text: message }], isError: true }
        }
      },
      { alwaysLoad: true },
    )],
  })
}
