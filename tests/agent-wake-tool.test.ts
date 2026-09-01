import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginAgentWakeTurn,
  endAgentWakeTurn,
  recordAgentWakeDecision,
} from '@/app/lib/cc/agentWakeTool'

afterEach(() => {
  endAgentWakeTurn('s1')
  vi.useRealTimers()
})

describe('set_agent_wake turn-local decision', () => {
  it('keeps only the last valid call in one turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    beginAgentWakeTurn('s1', 'background')
    recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 30, reason: '先看看' })
    recordAgentWakeDecision('s1', { action: 'cancel' })
    expect(endAgentWakeTurn('s1')).toEqual({ action: 'cancel' })
  })

  it('enforces interval, timezone, seven-day and reason boundaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    beginAgentWakeTurn('s1', 'foreground')
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 9 })).toThrow('10–10080')
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', at: '2026-09-01T12:00:00' })).toThrow('带时区')
    expect(() => recordAgentWakeDecision('s1', {
      action: 'schedule', after_minutes: 10, reason: '长'.repeat(31),
    })).toThrow('30')
  })

  it('uses the persisted window minimum for the current turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    beginAgentWakeTurn('s1', 'foreground', 20)
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 19 })).toThrow('20–10080')
    expect(recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 20 })).toMatchObject({ action: 'schedule' })
  })
})
