import 'server-only'
import path from 'node:path'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { YANZHI_FILES_ROOT } from '@/app/lib/artifactMeta'
import { getHavenGatewayConnection, joinHavenUrl } from '@/app/lib/havenConfig'
import type { RoomVisit, TurnBucket } from './processCollector'

export function isRoomTool(name: string, servers: Record<string, unknown>): boolean {
  return Object.keys(servers).some(server => name === `mcp__${server}__room`)
}

/** Only explicit native file paths are accepted. Bash gets a narrowly scoped shell grammar. */
export async function isPrivateRoomWrite(name: string, input: Record<string, unknown>, cwd: string): Promise<boolean> {
  if (!['Write', 'Edit', 'Bash'].includes(name)) return false
  let targets: string[]
  if (name === 'Bash') {
    const command = String(input.command || '')
    // A quoted heredoc never executes its body. All other shell syntax remains subject to approval.
    const heredoc = /^cat\s+>\s*("[^"$`]+"|'[^']+'|[^\s;$`|&<>()]+)\s+<<'([A-Z_]+)'\r?\n([\s\S]*?)\r?\n\2\s*$/.exec(command)
    const literalWrite = /^(?:echo\s+'[^']*'|printf\s+'[^']*'(?:\s+'[^']*')*)\s+>>?\s*("[^"$`]+"|'[^']+'|[^\s;$`|&<>()]+)\s*$/.exec(command)
    const match = /^(?:mkdir(?: -p)?|touch) (.+)$/.exec(command.trim())
    if (heredoc) {
      if (heredoc[3].split(/\r?\n/).includes(heredoc[2])) return false
      targets = [heredoc[1].replace(/^['"]|['"]$/g, '')]
    } else if (literalWrite) targets = [literalWrite[1].replace(/^['"]|['"]$/g, '')]
    else {
      if (!match || /[;$`|&<>\n\r()]/.test(command)) return false
      targets = match[1].match(/"[^"]+"|'[^']+'|\S+/g)?.map(s => s.replace(/^['"]|['"]$/g, '')) || []
    }
    if (!targets.length || targets.some(s => s.startsWith('-'))) return false
  } else targets = [String(input.file_path || '')]
  const root = path.resolve(YANZHI_FILES_ROOT, '.room')
  try {
    if ((await lstat(YANZHI_FILES_ROOT)).isSymbolicLink()) return false
    await realpath(YANZHI_FILES_ROOT)
    for (const target of targets) {
      if (!target) return false
      const absolute = path.resolve(cwd, target)
      const relative = path.relative(root, absolute)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false
      let current = YANZHI_FILES_ROOT
      for (const part of path.relative(YANZHI_FILES_ROOT, absolute).split(path.sep)) {
        current = path.join(current, part)
        try { if ((await lstat(current)).isSymbolicLink()) return false }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e }
      }
    }
    return true
  } catch { return false }
}

export async function roomFileList(roomId: string): Promise<string> {
  if (!/^room_[a-zA-Z0-9]+$/.test(roomId)) return ''
  const root = path.resolve(YANZHI_FILES_ROOT, '.room', roomId)
  const files: string[] = []
  try {
    for (const dir of [YANZHI_FILES_ROOT, path.dirname(root), root]) {
      if ((await lstat(dir)).isSymbolicLink()) return '\n\n房间文件：路径不可用'
    }
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        const info = await lstat(file)
        if (info.isSymbolicLink()) continue
        if (info.isDirectory()) await walk(file)
        else if (info.isFile()) files.push(`${path.relative(root, file)} · ${info.size} 字节`)
      }
    }
    await walk(root)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return '\n\n房间文件：暂时无法读取清单'
  }
  return `\n\n房间文件：\n${files.join('\n') || '暂无文件'}`
}

export async function saveRoomVisit(visit: RoomVisit): Promise<void> {
  const { baseUrl, token } = getHavenGatewayConnection()
  const response = await fetch(joinHavenUrl(baseUrl, '/api/rooms/visits'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(visit), signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`room visit HTTP ${response.status}`)
}

export async function sealRoomVisits(bucket: TurnBucket) {
  for (const visit of bucket.room.visits) {
    const door = bucket.processEvents.find(event => event.type === 'room' && event.id === visit.id)
    if (door?.sealed !== undefined) continue
    try { await saveRoomVisit(visit); if (door) door.sealed = true }
    catch { if (door) door.sealed = false; console.error('[room] 来访封存失败', visit.id) }
  }
}
