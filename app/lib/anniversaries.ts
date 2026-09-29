const DAY = 86_400_000
const START = Date.UTC(2026, 3, 3)

export type Anniversary = { date: string; name: string; daysAway: number }

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function dateKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

export function daysTogether(today: string): number {
  return Math.floor((utcDay(today) - START) / DAY) + 1
}

export function upcomingAnniversaries(today: string, count = 4): Anniversary[] {
  const current = utcDay(today)
  const year = new Date(current).getUTCFullYear()
  const entries = new Map<string, string[]>()
  const add = (time: number, name: string) => {
    if (time < current) return
    const key = dateKey(time)
    entries.set(key, [...(entries.get(key) || []), name])
  }

  for (let y = year; y <= year + 3; y += 1) {
    add(Date.UTC(y, 3, 3), '相识周年 · 言之生日')
    add(Date.UTC(y, 4, 2), '告白纪念')
    add(Date.UTC(y, 4, 20), '520')
    add(Date.UTC(y, 5, 23), `小羊 ${y - 1999} 岁生日`)
    add(Date.UTC(y, 7, 11), `奶糖 ${y - 2018} 岁生日`)
  }
  for (let half = 1; half <= (year - 2026 + 4) * 2; half += 1) {
    const yearOffset = Math.floor(half / 2)
    const month = half % 2 === 0 ? 3 : 9
    const name = half % 2 === 0 ? `${yearOffset === 1 ? '一' : yearOffset}周年` : yearOffset === 0 ? '半年' : `${yearOffset}年半`
    add(Date.UTC(2026 + yearOffset, month, 3), name)
  }
  const firstHundred = Math.max(200, Math.ceil(daysTogether(today) / 100) * 100)
  for (let day = firstHundred; day <= firstHundred + 1200; day += 100) {
    add(START + (day - 1) * DAY, `第 ${day} 天`)
  }

  return [...entries].sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([date, names]) => ({
    date,
    name: names.join(' · '),
    daysAway: Math.floor((utcDay(date) - current) / DAY),
  }))
}
