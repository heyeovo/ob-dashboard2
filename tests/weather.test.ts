import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { formatXiamenWeather, resetXiamenWeatherCache, xiamenWeatherContext } from '@/app/lib/weather'

const SAMPLE = {
  current: { temperature_2m: 31.4, weather_code: 2 },
  daily: {
    weather_code: [95],
    temperature_2m_max: [33.1],
    temperature_2m_min: [25.3],
    precipitation_probability_max: [100],
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetXiamenWeatherCache()
})

describe('厦门天气行', () => {
  it('当前天气 + 今天范围和降水概率', () => {
    expect(formatXiamenWeather(SAMPLE))
      .toBe('[厦门天气 现在 多云 31°C · 今天 雷阵雨 25–33°C 降水概率 100%]')
  })

  it('缺当前温度时整行不写；缺日数据只写现在', () => {
    expect(formatXiamenWeather({ daily: SAMPLE.daily })).toBe('')
    expect(formatXiamenWeather({ current: { temperature_2m: 20, weather_code: 61 } }))
      .toBe('[厦门天气 现在 小雨 20°C]')
  })

  it('请求失败返回空串，成功后命中缓存不再请求', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', failing)
    expect(await xiamenWeatherContext(1_000)).toBe('')

    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify(SAMPLE)))
    vi.stubGlobal('fetch', ok)
    const line = await xiamenWeatherContext(2_000)
    expect(line).toContain('雷阵雨')
    expect(await xiamenWeatherContext(2_000 + 10 * 60_000)).toBe(line)
    expect(ok).toHaveBeenCalledTimes(1)
  })
})
