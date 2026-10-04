import 'server-only'

// 后台唤醒轮次尾部的天气行（小羊在的城市）。行内刻意不写城市名，别加回去。只在 agent_wake 注入，闲聊每轮不加。
// 进程内缓存只是省请求的运行态，丢了重查即可；查不到就整行不写。

const XIAMEN = { latitude: 24.48, longitude: 118.09 }
const CACHE_MS = 20 * 60_000
const TIMEOUT_MS = 3_000

const WMO_LABELS: Record<number, string> = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾',
  51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨', 85: '阵雪', 86: '阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷阵雨伴冰雹',
}

type OpenMeteoForecast = {
  current?: { temperature_2m?: number; weather_code?: number }
  daily?: {
    weather_code?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: (number | null)[]
  }
}

let cache: { line: string; at: number } | null = null

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 把 Open-Meteo 返回整理成一行；缺当前天气时返回空串。 */
export function formatXiamenWeather(data: OpenMeteoForecast): string {
  const current = data.current
  if (!current || !finite(current.temperature_2m)) return ''
  const now = WMO_LABELS[current.weather_code ?? -1]
  const items = [`现在 ${now ? `${now} ` : ''}${Math.round(current.temperature_2m)}°C`]

  const daily = data.daily
  const max = daily?.temperature_2m_max?.[0]
  const min = daily?.temperature_2m_min?.[0]
  if (finite(max) && finite(min)) {
    const today = WMO_LABELS[daily?.weather_code?.[0] ?? -1]
    const rain = daily?.precipitation_probability_max?.[0]
    const tail = finite(rain) ? ` 降水概率 ${Math.round(rain)}%` : ''
    items.push(`今天 ${today ? `${today} ` : ''}${Math.round(min)}–${Math.round(max)}°C${tail}`)
  }
  return `[天气 ${items.join(' · ')}]`
}

export async function xiamenWeatherContext(now = Date.now()): Promise<string> {
  if (cache && now - cache.at < CACHE_MS) return cache.line
  const params = new URLSearchParams({
    latitude: String(XIAMEN.latitude),
    longitude: String(XIAMEN.longitude),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Asia/Shanghai',
    forecast_days: '1',
  })
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!response.ok) return ''
    const line = formatXiamenWeather(await response.json() as OpenMeteoForecast)
    if (line) cache = { line, at: now }
    return line
  } catch {
    return ''
  }
}

/** 测试用：清空进程内缓存。 */
export function resetXiamenWeatherCache(): void {
  cache = null
}
