// app/utils/format.ts

/** 给一个 UTC 时间字符串加上 8 小时，返回新的 Date 对象（北京时间） */
function utcToBeijing(dateStr: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  // 加上 8 小时（28800000 毫秒）
  return new Date(d.getTime() + 8 * 60 * 60 * 1000)
}

/** 格式化北京时间：仅日期（如 2026/06/08） */
export function formatBeijingDate(dateStr: string): string {
  const beijing = utcToBeijing(dateStr)
  if (!beijing) return '—'
  const year = beijing.getFullYear()
  const month = String(beijing.getMonth() + 1).padStart(2, '0')
  const day = String(beijing.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

/** 格式化北京时间：日期 + 时间（如 2026/06/08 10:37） */
export function formatBeijingDateTime(dateStr: string): string {
  const beijing = utcToBeijing(dateStr)
  if (!beijing) return '—'
  const year = beijing.getFullYear()
  const month = String(beijing.getMonth() + 1).padStart(2, '0')
  const day = String(beijing.getDate()).padStart(2, '0')
  const hour = String(beijing.getHours()).padStart(2, '0')
  const minute = String(beijing.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hour}:${minute}`
}

/** 获取北京时间的星期几（如”周一”） */
export function getBeijingDayOfWeek(dateStr: string): string {
  const beijing = utcToBeijing(dateStr)
  if (!beijing) return ''
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return days[beijing.getDay()]
}
const CHAT_STAMP_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function chatStampParts(date: Date) {
  return Object.fromEntries(CHAT_STAMP_PARTS.formatToParts(date).map(part => [part.type, part.value]))
}

/** 聊天消息时间戳（北京时间）：今天只写 HH:mm，昨天写「昨天 HH:mm」，更早带月日，跨年带年份。 */
export function formatChatStamp(value: string | number, now: Date = new Date()): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const at = chatStampParts(date)
  const clock = `${at.hour}:${at.minute}`
  const today = chatStampParts(now)
  if (at.year === today.year && at.month === today.month && at.day === today.day) return clock
  const yesterday = chatStampParts(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  if (at.year === yesterday.year && at.month === yesterday.month && at.day === yesterday.day) return `昨天 ${clock}`
  const day = `${Number(at.month)}月${Number(at.day)}日 ${clock}`
  return at.year === today.year ? day : `${at.year}年${day}`
}
