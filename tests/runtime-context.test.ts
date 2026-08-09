import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { beijingRuntimeContext } from '@/app/lib/runtimeContext'

describe('北京时间运行时信息', () => {
  it('直接给出同一北京时间日期对应的星期', () => {
    const result = beijingRuntimeContext(new Date('2026-08-09T06:33:59.000Z'))

    expect(result).toContain('当前北京时间：2026-08-09 14:33:59（星期日，UTC+08:00，Asia/Shanghai）。')
  })
})
