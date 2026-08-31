import 'server-only'

const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const BEIJING_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
})

/** 每轮注入用户消息尾部的动态时间戳。只含时间，不含 session_id 和时区说明。 */
export function beijingRuntimeContext(now = new Date()): string {
  const parts = Object.fromEntries(
    BEIJING_TIME_FORMATTER.formatToParts(now).map(part => [part.type, part.value]),
  )
  const weekday = BEIJING_WEEKDAY_FORMATTER.format(now)
  return `[北京时间 ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${weekday}]`
}

/** 放入 system prompt 的静态会话信息。session 生命周期内不变，只需缓存写一次。 */
export function sessionStaticContext(sessionId: string): string {
  return (
    `当前会话 session_id：${sessionId}\n` +
    '所有时间戳均为北京时间（UTC+08:00，Asia/Shanghai）。'
  )
}
