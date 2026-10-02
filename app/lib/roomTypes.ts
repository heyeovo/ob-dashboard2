import type { CcProcessEvent, CcToolEvent } from '@/app/cc/types'

export type Room = {
  id: string; title: string; status: 'closed' | 'opened'; lock_until: string
  created_at: string; opened_at: string; last_visit: string
  visit_count: number; total_duration_ms: number
  last_visit_duration_ms?: number
  entries?: { id: string; created_at: string; content: string }[]
  visits?: RoomVisit[]
}
export type RoomVisit = {
  id: string; room_id: string; room_title?: string; entered_at: string; left_at: string
  duration_ms: number; turn_kind?: 'chat' | 'agent_wake'; process?: CcProcessEvent[]
}
export type RoomFile = { name: string; size: number; mime: string }
export const ROOM_LAST_SEEN = 'ob2.room.lastSeenAt'
export function roomHasNewVisit(rooms: Room[], lastSeen: string | null): boolean {
  const seen = Date.parse(lastSeen || '') || 0
  return rooms.some(room => room.status === 'closed' && Date.parse(room.last_visit) > seen)
}
export function roomDuration(ms: number): string {
  if (ms < 60_000) return '不到 1 分钟'
  const minutes = Math.floor(ms / 60_000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`
}
export function roomDate(value: string, style: 'short' | 'full' | 'day' | 'time' = 'short'): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]))
  if (style === 'time') return `${parts.hour}:${parts.minute}`
  if (style === 'day') return `${parts.year}-${parts.month}-${parts.day}`
  if (style === 'full') return `${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}
export function roomVisitHref(roomId: string, id: string): string {
  return `/room${roomId ? `/${encodeURIComponent(roomId)}` : ''}#visit-${encodeURIComponent(id)}`
}
export function unwrapRoomResult(raw: string): string {
  try { const parsed = JSON.parse(raw); if (typeof parsed?.result === 'string') return parsed.result } catch {}
  return raw
}
export function parseRoomReveal(tool: CcToolEvent) {
  if (!/^mcp__.+__room$/.test(tool.name) || (tool.input as { action?: string })?.action !== 'open') return null
  const text = unwrapRoomResult(tool.result || '')
  const match = /^房间已打开 \[(room_[a-zA-Z0-9]+)\]([^\n]*)\n?/.exec(text)
  if (!match) return null
  const [body, fileText = ''] = text.slice(match[0].length).split(/\n\n房间文件：\n?/)
  return { id: match[1], title: match[2].trim() || '未命名', body: body.trim(), files: fileText.split('\n').filter(line => line.trim() && line !== '暂无文件') }
}
