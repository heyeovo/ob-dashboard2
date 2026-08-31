import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { beijingRuntimeContext, sessionStaticContext } from '@/app/lib/runtimeContext'

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
})
