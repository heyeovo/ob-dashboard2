import { describe, expect, it } from 'vitest'

import { formatChatStamp } from '@/app/utils/format'

// now = 北京时间 2026-10-04 17:40
const NOW = new Date('2026-10-04T09:40:00.000Z')

describe('聊天时间戳', () => {
  it('今天只写时分，按北京时间判断日期', () => {
    expect(formatChatStamp('2026-10-04T01:05:00.000Z', NOW)).toBe('09:05')
    expect(formatChatStamp('2026-10-03T16:30:00.000Z', NOW)).toBe('00:30')
  })

  it('昨天、更早和跨年', () => {
    expect(formatChatStamp('2026-10-03T14:37:00.000Z', NOW)).toBe('昨天 22:37')
    expect(formatChatStamp('2026-10-02T15:59:00.000Z', NOW)).toBe('10月2日 23:59')
    expect(formatChatStamp('2025-12-31T15:00:00.000Z', NOW)).toBe('2025年12月31日 23:00')
  })

  it('无效时间显示占位', () => {
    expect(formatChatStamp('not a date', NOW)).toBe('—')
  })
})
