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

const BEIJING_CLOCK_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type UsageWindow = { utilization: number | null; resetsAt: string | null } | null

export type WorkStatusInput = {
  contextTokens: number
  contextMaxTokens: number
  /** undefined = 不是订阅线路，不写额度；null = 订阅线路但读不到。 */
  proUsage?: { fiveHour: UsageWindow; sevenDay: UsageWindow; updatedAt: string } | null
  now?: Date
}

function formatWan(tokens: number): string {
  return `${Number((tokens / 10_000).toFixed(1))}万`
}

function formatReset(iso: string | null, withDate: boolean): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(
    BEIJING_CLOCK_FORMATTER.formatToParts(date).map(part => [part.type, part.value]),
  )
  const clock = `${parts.hour}:${parts.minute}`
  return `（${withDate ? `${parts.month}-${parts.day} ` : ''}${clock} 重置）`
}

function formatWindow(label: string, window: UsageWindow, withDate: boolean): string {
  if (!window || window.utilization == null) return `${label} 读不到`
  return `${label} ${Math.round(window.utilization)}%${formatReset(window.resetsAt, withDate)}`
}

/**
 * 工作模式每轮追加在时间戳后的状态行：上下文用量和 Pro 额度，供模型自己分配工作量。
 * 闲聊模式不注入。上下文取上一轮结束时的快照；额度取进程内最近一次读取值并注明读取时间。
 */
export function workStatusContext(input: WorkStatusInput): string {
  const now = input.now || new Date()
  const items: string[] = []
  if (input.contextTokens > 0 && input.contextMaxTokens > 0) {
    const percent = Math.round((input.contextTokens / input.contextMaxTokens) * 100)
    items.push(`上下文 ${percent}%（${formatWan(input.contextTokens)}/${formatWan(input.contextMaxTokens)}）`)
  } else {
    items.push('上下文 读不到')
  }
  if (input.proUsage === null) {
    items.push('Pro 额度 读不到')
  } else if (input.proUsage) {
    const usage = input.proUsage
    items.push(formatWindow('Pro 5h', usage.fiveHour, false))
    items.push(formatWindow('周', usage.sevenDay, true))
    const ageMinutes = Math.floor((now.getTime() - new Date(usage.updatedAt).getTime()) / 60_000)
    if (Number.isFinite(ageMinutes) && ageMinutes >= 1) items.push(`额度读于 ${ageMinutes} 分钟前`)
  }
  return `[工作状态 ${items.join(' · ')}]`
}

/** 放入 system prompt 的静态会话信息。session 生命周期内不变，只需缓存写一次。 */
export function sessionStaticContext(sessionId: string): string {
  return (
    `当前会话 session_id：${sessionId}\n` +
    '所有时间戳均为北京时间（UTC+08:00，Asia/Shanghai）。'
  )
}
