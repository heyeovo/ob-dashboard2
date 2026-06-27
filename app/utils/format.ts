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

/**
 * 将时间字符串拆分为 timeline 日期组件所需的两段
 * 返回 { headline: “23 Jun”, caption: “2026 · 周六” }
 * 若解析失败返回 null
 */
export function formatTimelineDateParts(dateStr: string): { headline: string; caption: string } | null {
  const datePart = formatBeijingDate(dateStr)
  if (datePart === '—') return null
  const dayOfWeek = getBeijingDayOfWeek(dateStr)
  const parts = datePart.split('/')
  if (parts.length < 3) return null
  const day = parseInt(parts[2], 10)
  const monthNum = parseInt(parts[1], 10) - 1
  const year = parts[0]
  const monthShort = new Date(Date.UTC(2000, monthNum)).toLocaleDateString('en', { month: 'short' })
  return { headline: `${day} ${monthShort}`, caption: `${year} · ${dayOfWeek}` }
}

/** 获取北京时间的星期几（如”周一”） */
export function getBeijingDayOfWeek(dateStr: string): string {
  const beijing = utcToBeijing(dateStr)
  if (!beijing) return ''
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return days[beijing.getDay()]
}