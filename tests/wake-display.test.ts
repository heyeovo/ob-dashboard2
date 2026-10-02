import { describe, expect, it } from 'vitest'
import { parseWakeOps, wakeDisplayLines } from '@/app/cc/wakeDisplay'
import { parseTurnRaw, turnsToMessages } from '@/app/cc/ccHistory'

describe('alarm message display', () => {
  const ops = [
    { action: 'schedule', at: '2026-10-02T13:00:00Z', reason: '吃药' },
    { action: 'schedule', at: '2026-10-02T14:00:00Z', reason: '睡觉' },
    { action: 'cancel', at: '2026-10-02T14:00:00Z' },
    { action: 'cancel' },
    { action: 'followup', at: '2026-10-02T13:05:00Z', reason: '问一下' },
  ]
  it('shows every op and keeps legacy next_wake readable', () => {
    const raw = parseTurnRaw(JSON.stringify({ wake_ops: ops }))
    expect(wakeDisplayLines({ wakeOps: raw.wakeOps })).toEqual([
      '↳ 闹钟 21:00 · 吃药', '↳ 闹钟 22:00 · 睡觉', '↳ 取消闹钟 22:00', '↳ 取消全部闹钟', '↳ 下次唤醒 21:05 · 问一下',
    ])
    const old = parseTurnRaw(JSON.stringify({ next_wake: { at: ops[0].at, reason: '旧闹钟' } }))
    expect(wakeDisplayLines({ nextWake: old.nextWake! })).toEqual(['↳ 下次唤醒 21:00 · 旧闹钟'])
    expect(parseWakeOps(null)).toBeUndefined()
    expect(parseWakeOps([{ action: 'list' }, null])).toEqual([])
  })
  it('attaches ops to saved assistant messages and no-op wake events', () => {
    for (const assistant of ['正文', '']) {
      const messages = turnsToMessages([{ id: 1, user_text: '', assistant_text: assistant,
        created_at: '2026-10-02T12:00:00Z', turn_kind: 'agent_wake', source: 'cc',
        raw_json: JSON.stringify({ wake_ops: ops, agent_wake: { cause: 'agent_schedule', at: ops[0].at } }),
      }])
      expect(messages.at(-1)?.wakeOps).toEqual(ops)
    }
  })
})
