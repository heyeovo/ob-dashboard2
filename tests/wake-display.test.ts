import { describe, expect, it } from 'vitest'
import { parseWakeOps, wakeDisplayLines } from '@/app/cc/wakeDisplay'
import { parseTurnRaw, turnsToMessages } from '@/app/cc/ccHistory'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CcMessageRow from '@/app/cc/CcMessageRow'

describe('alarm message display', () => {
  it.each(['quiet', 'loud', undefined])('maps and renders delivery %s with legacy marker cleanup', delivery => {
    const raw = JSON.stringify({ agent_wake: { cause: 'agent_schedule', delivery },
      process: [{ type: 'text', id: 'body', text: ' \n[agent_wake_quiet] 留一句' },
        { type: 'text', id: 'middle', text: '正文中 [agent_wake_quiet] 保留' }],
      display_segments: { version: 3, segments: [{ kind: 'text', markdown: '[agent_wake_quiet] 留一句' }] },
    })
    const messages = turnsToMessages([{ id: 1, user_text: '', assistant_text: '[agent_wake_quiet] 留一句',
      created_at: '2026-10-04T12:00:00Z', turn_kind: 'agent_wake', raw_json: raw }])
    expect(parseTurnRaw(raw).agentWake?.delivery).toBe(delivery)
    expect(messages[0].wakeEvent?.delivery).toBe(delivery)
    expect(messages[1].text).toBe('留一句')
    expect(messages[1].process?.filter(event => event.type === 'text').map(event => event.text))
      .toEqual(['留一句', '正文中 [agent_wake_quiet] 保留'])
    expect(messages[1].displaySegments?.[0].markdown).toBe('留一句')
    const html = renderToStaticMarkup(createElement(CcMessageRow, {
      message: messages[0], isCurrentTurn: false, onCopy: () => {},
    }))
    expect(html.includes('没有提醒你')).toBe(delivery === 'quiet')
    const ordinary = turnsToMessages([{ id: 2, user_text: '', assistant_text: '[agent_wake_quiet] 普通回复',
      created_at: '2026-10-04T12:00:00Z', turn_kind: 'user' }])
    expect(ordinary.at(-1)?.text).toBe('[agent_wake_quiet] 普通回复')
    const legacy = turnsToMessages([{ id: 3, user_text: '', assistant_text: '[agent_wake_quiet] 留一句',
      created_at: '2026-10-04T12:00:00Z', turn_kind: 'agent_wake' }])
    expect(legacy.at(-1)?.displaySegments?.[0].markdown).toBe('留一句')
  })
  it.each(['before', 'after'])('hides old no-op process text %s a room event while preserving ordinary turns', position => {
    const marker = { type: 'text', id: 'noop', text: ' \n[agent_wake_noop] 路过了，不打扰' }
    const room = { type: 'room', id: 'visit', roomId: 'room_abc', enteredAt: 1000, leftAt: 2000 }
    const tool = { type: 'tool', id: 'tool', tool: { id: 't1', name: 'Read', input: {}, status: 'done' } }
    const process = position === 'before' ? [marker, tool, room] : [tool, room, marker]
    const turn = { id: 1, user_text: '', assistant_text: '', request_id: 'wake-old',
      created_at: '2026-10-02T12:00:00Z', source: 'cc', raw_json: JSON.stringify({ process }) }
    const messages = turnsToMessages([{ ...turn, turn_kind: 'agent_wake' }])
    const assistant = messages.find(message => message.role === 'assistant')!
    expect(assistant.process?.map(event => event.type)).toEqual(['tool', 'room'])
    const html = renderToStaticMarkup(createElement(CcMessageRow, {
      message: assistant, isCurrentTurn: false, onCopy: () => {},
    }))
    expect(html).not.toContain('[agent_wake_noop]')
    expect(html).toContain('言之进了房间')
    expect(turnsToMessages([{ ...turn, turn_kind: 'user' }]).at(-1)?.process)
      .toEqual(parseTurnRaw(turn.raw_json).process)
  })
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
