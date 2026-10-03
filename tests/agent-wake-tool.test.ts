import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAgentWakeQuiet } from '@/app/lib/cc/agentWakeTool'
import { DEFAULT_AGENT_WAKE_INSTRUCTIONS, DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION } from '@/app/lib/cc/agentWakePrompt'
import { readFileSync } from 'node:fs'

describe('quiet wake marker and exact default prompts', () => {
  it.each([
    [' \n[agent_wake_quiet] 留一句 \n', { text: '留一句' }],
    ['正文 [agent_wake_quiet] 留一句', null],
    ['[agent_wake_quiet] \n', null],
    ['[agent_wake_noop] [agent_wake_quiet] 留一句', null],
  ])('parses only a leading marker: %s', (text, expected) => {
    expect(parseAgentWakeQuiet(text)).toEqual(expected)
  })
  it('matches both handoff prompt blocks verbatim', () => {
    const spec = readFileSync('docs/handoff/HANDOFF-wake-quiet.md', 'utf8')
    const blocks = [...spec.matchAll(/```\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1].replace(/\r\n/g, '\n'))
    expect(DEFAULT_AGENT_WAKE_INSTRUCTIONS).toBe(blocks[0])
    expect(DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION).toBe(blocks[1])
  })
})
import {
  beginAgentWakeTurn,
  endAgentWakeTurn,
  agentWakeMcpModelSurface,
  parseAgentWakeNoop,
  recordAgentWakeDecision,
  agentWakeTurnSummary,
} from '@/app/lib/cc/agentWakeTool'
import { builtInMcpModelSurfaces, builtInMcpServerNames } from '@/app/lib/cc/builtInMcp'

afterEach(() => {
  endAgentWakeTurn('s1')
  vi.useRealTimers()
})

describe('set_agent_wake turn-local decision', () => {
  it('adds multiple alarms, lists Beijing times, rejects the sixth and cancels by id', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'))
    beginAgentWakeTurn('s1', 'foreground', 10, true, 3,
      [{ alarm_id: 'w_old123', at: '2026-10-02T12:10:00Z', reason: '原有' }])
    for (let i = 1; i <= 4; i++) recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: i * 20, reason: `新${i}` })
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 10 })).toThrow('最多同时挂 5 个闹钟，先取消一个')
    expect(recordAgentWakeDecision('s1', { action: 'list' })).toEqual({ action: 'list' })
    expect(agentWakeTurnSummary('s1').split('\n')).toHaveLength(5)
    expect(agentWakeTurnSummary('s1')).toContain('w_old123 · 10-02 20:10 · 原有')
    expect(() => recordAgentWakeDecision('s1', { action: 'cancel', alarm_id: 'absent' })).toThrow('不存在')
    expect(recordAgentWakeDecision('s1', { action: 'cancel', alarm_id: 'w_old123' })).toMatchObject({ action: 'cancel', at: '2026-10-02T12:10:00Z' })
    expect(agentWakeTurnSummary('s1')).not.toContain('w_old123')
    recordAgentWakeDecision('s1', { action: 'followup', after_minutes: 3, reason: '追问1' })
    recordAgentWakeDecision('s1', { action: 'followup', after_minutes: 4, reason: '追问2' })
    expect(agentWakeTurnSummary('s1')).toContain('followup · 10-02 20:04 · 追问2')
    expect(agentWakeTurnSummary('s1')).not.toContain('追问1')
    const ops = endAgentWakeTurn('s1')
    expect(ops).toHaveLength(7)
    expect(ops.filter(op => op.action === 'schedule')).toHaveLength(4)
  })

  it('cancels all alarms and followup without recording list calls', () => {
    beginAgentWakeTurn('s1', 'foreground', 10, true, 3,
      [{ alarm_id: 'w_old123', at: '2026-10-02T12:10:00Z', reason: '原有' }], '2026-10-02T12:15:00Z')
    recordAgentWakeDecision('s1', { action: 'cancel' })
    recordAgentWakeDecision('s1', { action: 'list' })
    expect(agentWakeTurnSummary('s1')).toBe('没有挂着的闹钟')
    expect(endAgentWakeTurn('s1')).toEqual([{ action: 'cancel' }])
  })
  it('keeps all wake guidance in the top-level tool description', () => {
    const surface = agentWakeMcpModelSurface()
    expect(surface).not.toHaveProperty('instructions')
    expect(surface.tools[0].description).toContain('收到 <agent_wake .../>')
    expect(surface.tools[0].description).toContain('action: schedule')
  })

  it('removes the complete built-in MCP surface when disabled', () => {
    expect(builtInMcpServerNames({ ombre_agent_wake: false })).not.toContain('ombre_agent_wake')
    expect(builtInMcpModelSurfaces({ ombre_agent_wake: false }))
      .not.toContainEqual(expect.objectContaining({ name: 'ombre_agent_wake' }))
  })

  it('keeps valid calls in order in one turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    beginAgentWakeTurn('s1', 'background')
    recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 30, reason: '先看看' })
    recordAgentWakeDecision('s1', { action: 'cancel' })
    expect(endAgentWakeTurn('s1')).toEqual([
      expect.objectContaining({ action: 'schedule', reason: '先看看' }), { action: 'cancel' },
    ])
  })

  it('enforces interval, timezone, seven-day and reason boundaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    beginAgentWakeTurn('s1', 'foreground')
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 9 })).toThrow('10–10080')
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', at: '2026-09-01T12:00:00' })).toThrow('带时区')
    expect(() => recordAgentWakeDecision('s1', {
      action: 'schedule', after_minutes: 10, reason: '长'.repeat(51),
    })).toThrow('50')
    expect(recordAgentWakeDecision('s1', {
      action: 'schedule', after_minutes: 10, reason: '长'.repeat(50),
    })).toMatchObject({ action: 'schedule' })
  })

  it('parses an optional short status after the no-op marker', () => {
    expect(parseAgentWakeNoop('[agent_wake_noop] 想你，但不打扰')).toEqual({ status: '想你，但不打扰' })
    expect(parseAgentWakeNoop('[agent_wake_noop]')).toEqual({ status: '' })
    expect(parseAgentWakeNoop('普通消息')).toBeNull()
  })

  it('uses the persisted window minimum for the current turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    beginAgentWakeTurn('s1', 'foreground', 20)
    expect(() => recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 19 })).toThrow('20–10080')
    expect(recordAgentWakeDecision('s1', { action: 'schedule', after_minutes: 20 })).toMatchObject({ action: 'schedule' })
  })
})
