// 「我们说过多少字」：Haven 按天、按模式回字数，这里合成主页那一行和详情。
// 字数 = 去掉空格、换行、制表符后的字符数，中文一个字、英文一个字母都算 1。

export type WordStatsDay = {
  day: string
  mode: string
  turn_count: number
  user_chars: number
  assistant_chars: number
}

/** Haven 里最早的聊天是 2026-07-12；之前在官端的部分用小羊三个月纪念日（7.2）亲手数的数当起点 */
export const WORD_BASELINE = { chars: 600_000, until: '2026-07-02', note: '搬家前 · 小羊数的' }

export type WordSummary = {
  total: number
  stored: number
  user: number
  assistant: number
  chat: number
  work: number
  today: number
  firstDay: string
  months: { month: string; chars: number }[]
}

export function summarizeWordStats(days: WordStatsDay[], today: string): WordSummary {
  let user = 0
  let assistant = 0
  let chat = 0
  let work = 0
  let todayChars = 0
  let firstDay = ''
  const months = new Map<string, number>()
  for (const row of days) {
    const userChars = Number(row.user_chars) || 0
    const assistantChars = Number(row.assistant_chars) || 0
    const chars = userChars + assistantChars
    user += userChars
    assistant += assistantChars
    if (row.mode === 'work') work += chars
    else chat += chars
    if (row.day === today) todayChars += chars
    if (row.day && (!firstDay || row.day < firstDay)) firstDay = row.day
    const month = row.day.slice(0, 7)
    if (month) months.set(month, (months.get(month) || 0) + chars)
  }
  const stored = user + assistant
  return {
    total: WORD_BASELINE.chars + stored,
    stored,
    user,
    assistant,
    chat,
    work,
    today: todayChars,
    firstDay,
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, chars]) => ({ month, chars })),
  }
}

/** 主页那一行用：一万以上写成「222 万」，一位小数只在 100 万以下保留 */
export function formatWan(chars: number): string {
  if (chars < 10_000) return chars.toLocaleString('zh-CN')
  const wan = chars / 10_000
  return `${wan >= 100 ? Math.floor(wan) : Math.floor(wan * 10) / 10} 万`
}
