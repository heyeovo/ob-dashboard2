import 'server-only'
import path from 'node:path'
import { lstat, realpath, readdir, open } from 'node:fs/promises'
import { YANZHI_FILES_ROOT } from './artifactMeta'
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'
import { isInside, safeSegments, mimeType, isTextFile, TEXT_LIMIT } from './fileBrowser'
import { ROOM_DOOR_TITLE } from './roomPrivacy'
import type { Room, RoomFile } from './roomTypes'

export const roomIdValid = (id: string) => /^room_[a-zA-Z0-9]+$/.test(id)
export const roomHeaders = { 'Cache-Control': 'no-store' }
export async function fetchRoomHaven(endpoint: string) {
  const { baseUrl, token } = getHavenGatewayConnection()
  return fetch(joinHavenUrl(baseUrl, endpoint), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
}
/** Defense in depth even if upstream accidentally adds a note to nested data. */
export function withoutRoomNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRoomNotes)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'note').map(([key, item]) => [key, withoutRoomNotes(item)]))
  return value
}
export async function relayRooms(endpoint: string) {
  try {
    const upstream = await fetchRoomHaven(endpoint)
    return Response.json(withoutRoomNotes(await upstream.json()), { status: upstream.status, headers: roomHeaders })
  } catch { return Response.json({ error: '暂时无法读取房间' }, { status: 502, headers: roomHeaders }) }
}
export async function openedRoom(id: string): Promise<Room | null> {
  if (!roomIdValid(id)) return null
  const response = await fetchRoomHaven(`/api/rooms/${id}`)
  if (!response.ok) return null
  const room = await response.json() as Room
  return room.status === 'opened' ? room : null
}
/** Reject links in every lexical ancestor, then verify the resolved file stays in its room. */
export async function roomFilePath(id: string, relative = '', root = YANZHI_FILES_ROOT): Promise<string | null> {
  if (!roomIdValid(id)) return null
  const parts = safeSegments(relative)
  if (!parts) return null
  const base = path.resolve(root, '.room', id)
  let current = path.parse(base).root
  try {
    for (const part of path.relative(current, path.join(base, ...parts)).split(path.sep)) {
      current = path.join(current, part)
      if ((await lstat(current)).isSymbolicLink()) return null
    }
    const actual = await realpath(current)
    return isInside(base, actual) ? actual : null
  } catch { return null }
}
export async function listRoomFiles(id: string): Promise<RoomFile[]> {
  const base = await roomFilePath(id)
  if (!base) return []
  const files: RoomFile[] = []
  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (!safeSegments(name)) continue
      const target = await roomFilePath(id, name)
      if (!target) continue
      const info = await lstat(target)
      if (info.isDirectory()) await walk(target, name + '/')
      else if (info.isFile()) files.push({ name, size: info.size, mime: mimeType(name) })
    }
  }
  await walk(base, '')
  return files.sort((a, b) => a.name.localeCompare(b.name))
}
export async function readRoomFile(id: string, name: string, raw: boolean): Promise<Response> {
  const target = await roomFilePath(id, name)
  if (!target || !(await lstat(target)).isFile()) return Response.json({ error: '找不到文件' }, { status: 404, headers: roomHeaders })
  const handle = await open(target, 'r')
  try {
    const info = await handle.stat()
    if (raw) return new Response(new Uint8Array(await handle.readFile()), { headers: { ...roomHeaders, 'Content-Type': mimeType(name), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' } })
    const buffer = Buffer.alloc(Math.min(info.size, TEXT_LIMIT))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return Response.json({ name, size: info.size, mime: mimeType(name), text: isTextFile(name) ? buffer.subarray(0, bytesRead).toString('utf8') : undefined, truncated: info.size > TEXT_LIMIT }, { headers: roomHeaders })
  } finally { await handle.close() }
}
export async function loadRoomDoors(sessionId: string, revision: number, chatDay: string): Promise<string> {
  try {
    const query = new URLSearchParams({ session_id: sessionId, key: `${revision}:${chatDay}` })
    const response = await fetchRoomHaven(`/api/rooms/door-snapshot?${query}`)
    if (!response.ok) return ''
    const content = String((await response.json()).content || '').trim()
    return content.startsWith(ROOM_DOOR_TITLE) && content !== ROOM_DOOR_TITLE ? content : ''
  } catch { return '' }
}
