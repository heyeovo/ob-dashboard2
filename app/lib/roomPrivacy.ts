export const ROOM_DOOR_TITLE = '【我的房间 · 今天的门牌】'
/** The snapshot is the last rolling section. Seal through its trusted closing boundary. */
export function redactRoomDoors(content: string): string {
  const start = content.indexOf(ROOM_DOOR_TITLE)
  if (start < 0) return content
  const end = content.lastIndexOf('</rolling_window_context>')
  return content.slice(0, start) + ROOM_DOOR_TITLE + '已封存' + (end > start ? '\n\n' + content.slice(end) : '')
}
export function redactRoomDoorsDeep<T>(value: T): T {
  if (typeof value === 'string') return redactRoomDoors(value) as T
  if (Array.isArray(value)) return value.map(redactRoomDoorsDeep) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactRoomDoorsDeep(item)])) as T
  return value
}
