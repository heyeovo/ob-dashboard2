import 'server-only'

const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const BEIJING_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  weekday: 'long',
})

export function beijingRuntimeContext(now = new Date()): string {
  const parts = Object.fromEntries(
    BEIJING_TIME_FORMATTER.formatToParts(now).map(part => [part.type, part.value]),
  )
  const timestamp = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
  const weekday = BEIJING_WEEKDAY_FORMATTER.format(now)
  return (
    '<运行时信息>\n' +
    `当前北京时间：${timestamp}（${weekday}，UTC+08:00，Asia/Shanghai）。` +
    '这是系统提供的隐藏时间，不是用户消息。\n' +
    '</运行时信息>'
  )
}
