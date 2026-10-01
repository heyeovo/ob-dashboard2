import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { beijingRuntimeContext, sessionStaticContext, workStatusContext } from '@/app/lib/runtimeContext'

describe('北京时间运行时信息', () => {
  it('返回精简的北京时间戳和星期', () => {
    const result = beijingRuntimeContext(new Date('2026-08-09T06:33:59.000Z'))

    expect(result).toBe('[北京时间 2026-08-09 14:33 周日]')
  })

  it('sessionStaticContext 包含 session_id 和时区说明', () => {
    const result = sessionStaticContext('ob2-20260831-test')

    expect(result).toContain('session_id：ob2-20260831-test')
    expect(result).toContain('UTC+08:00')
  })

  it('工作状态行包含上下文、5 小时与每周额度和重置时间', () => {
    const result = workStatusContext({
      contextTokens: 312_345,
      contextMaxTokens: 1_000_000,
      proUsage: {
        fiveHour: { utilization: 38.4, resetsAt: '2026-10-01T16:40:00.000Z' },
        sevenDay: { utilization: 71, resetsAt: '2026-10-05T01:00:00.000Z' },
        updatedAt: '2026-10-01T15:10:00.000Z',
      },
      now: new Date('2026-10-01T15:13:30.000Z'),
    })

    expect(result).toBe('[工作状态 上下文 31%（31.2万/100万） · Pro 5h 38%（00:40 重置） · 周 71%（10-05 09:00 重置） · 额度读于 3 分钟前]')
  })

  it('读不到时如实写读不到，非订阅线路不写额度', () => {
    expect(workStatusContext({ contextTokens: 0, contextMaxTokens: 0, proUsage: null }))
      .toBe('[工作状态 上下文 读不到 · Pro 额度 读不到]')
    expect(workStatusContext({ contextTokens: 50_000, contextMaxTokens: 200_000 }))
      .toBe('[工作状态 上下文 25%（5万/20万）]')
  })
})
