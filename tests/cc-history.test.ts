// ccHistory（Haven 历史 → 界面消息）的测试（9.5 步建）。
//
// 覆盖架构 handoff 第 9.5 步验收清单的第 8 条：
//   旧历史无 process 时仍能正常展示 —— 老消息的 raw_json 只有合并正文，
//   没有 thinking / 工具 / process，转出来的消息要干净、不报错。

import { describe, it, expect } from 'vitest'
import { turnsToMessages, parseTurnRaw, modeOfTurns, metaOfTurns } from '@/app/cc/ccHistory'
import type { HavenTurnRow } from '@/app/cc/ccHistory'

function turn(overrides: Partial<HavenTurnRow>): HavenTurnRow {
  return {
    id: 1,
    user_text: '用户说的',
    assistant_text: '助手回的',
    created_at: '2026-07-01T10:00:00Z',
    source: 'cc',
    ...overrides,
  }
}

describe('ccHistory：旧历史兼容', () => {
  it('maps an agent wake into event, optional assistant bubbles and next wake', () => {
    const messages = turnsToMessages([turn({
      id: 9,
      round_id: 4,
      turn_kind: 'agent_wake',
      user_text: '',
      assistant_text: '第一句。\n第二句。',
      raw_json: JSON.stringify({
        agent_wake: { wake_id: 'wake-9', cause: 'cache_keepalive', at: '2026-08-31T12:55:00Z' },
        next_wake: { at: '2026-08-31T13:25:00Z', reason: '稍后再看' },
        display_segments: {
          version: 1,
          segments: [
            { kind: 'text', markdown: '第一句。\n' },
            { kind: 'text', markdown: '第二句。' },
          ],
        },
      }),
    })])
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'system', wakeEvent: { cause: 'cache_keepalive' } })
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      text: '第一句。\n第二句。',
      nextWake: { reason: '稍后再看' },
    })
    expect(messages[1].displaySegments).toHaveLength(2)
  })

  it('keeps a no-op wake as an event and shows next wake under it', () => {
    const messages = turnsToMessages([turn({
      id: 10,
      turn_kind: 'agent_wake',
      user_text: '',
      assistant_text: '',
      raw_json: JSON.stringify({
        agent_wake: { cause: 'conversation_silence', at: '2026-08-31T12:55:00Z' },
        next_wake: { at: '2026-08-31T13:25:00Z', reason: '等等看' },
      }),
    })])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'system', nextWake: { reason: '等等看' } })
  })

  it('没有 raw_json 的老消息正常展示，不带 thinking / 工具 / process', () => {
    const rows: HavenTurnRow[] = [
      turn({ id: 1, user_text: '第一句', assistant_text: '第一答' }),
      turn({ id: 2, user_text: '第二句', assistant_text: '第二答' }),
    ]
    const messages = turnsToMessages(rows)

    expect(messages).toHaveLength(4)
    const firstAssistant = messages[1]
    expect(firstAssistant).toMatchObject({
      role: 'assistant',
      text: '第一答',
      fromHistory: true,
    })
    // 老消息没有这三个字段 —— 界面不显示对应区块，也不报错
    expect(firstAssistant.thinking).toBeUndefined()
    expect(firstAssistant.tools).toBeUndefined()
    expect(firstAssistant.process).toBeUndefined()
    expect(firstAssistant.cacheSnapshot).toMatchObject({
      refreshedAt: Date.parse('2026-07-01T10:00:00Z'),
      systemTtlMs: 3_600_000,
      sessionTtlMs: 300_000,
    })
    // usage 原代码显式传 null（parseTurnRaw 的空值），界面同样不显示
    expect(firstAssistant.usage).toBeNull()
  })

  it('raw_json 是坏 JSON / 存根时不崩，退回无附属字段', () => {
    const rows: HavenTurnRow[] = [
      turn({
        id: 3,
        raw_json: '{_truncated, original_chars: 99999}', // Haven 超长存根，不是合法 JSON
        assistant_text: '超长的回复（正文在 raw 之外，assistant_text 仍有）',
      }),
      turn({
        id: 4,
        raw_json: 'not json at all',
        assistant_text: '坏 JSON 的回复',
      }),
    ]
    const messages = turnsToMessages(rows)
    expect(messages).toHaveLength(4)
    for (const m of messages) {
      if (m.role === 'assistant') {
        expect(m.process).toBeUndefined()
        expect(m.tools).toBeUndefined()
      }
    }
  })

  it('有 process 的新消息按原顺序还原（thinking / tool / text 穿插）', () => {
    const rows: HavenTurnRow[] = [
      turn({
        id: 5,
        assistant_text: '最终回答',
        raw_json: JSON.stringify({
          thinking: '草稿',
          tools: [{ id: 't1', name: 'Read', status: 'completed' }],
          process: [
            { type: 'thinking', id: 'p1', text: '草稿', startedAt: 1 },
            { type: 'tool', id: 'p2', tool: { id: 't1', name: 'Read', status: 'completed' } },
            { type: 'text', id: 'p3', text: '过程文字' },
          ],
        }),
      }),
    ]
    const messages = turnsToMessages(rows)
    const assistant = messages[1]
    expect(assistant.process).toHaveLength(3)
    expect(assistant.process!.map(p => p.type)).toEqual(['thinking', 'tool', 'text'])
    expect(assistant.thinking).toBe('草稿')
    expect(assistant.tools).toHaveLength(1)
  })

  it('压缩分隔线按真实位置恢复，手动压缩标记落在下一轮用户消息之前', () => {
    const compaction = {
      id: 'compact-manual-1', trigger: 'manual', preTokens: 186_000,
      postTokens: 42_000, durationMs: 1200, at: 1_786_000_000_000,
    }
    const messages = turnsToMessages([turn({
      id: 6,
      raw_json: JSON.stringify({
        engine: 'cc',
        cc_lane_id: 'subscription',
        pre_compactions: [compaction],
        context_snapshot: {
          totalTokens: 43_000, inputTokens: 42_500, outputTokens: 500,
          maxTokens: 200_000, remainingTokens: 157_000, percentage: 21.5,
          updatedAt: 1_786_000_001_000, model: 'claude-opus-4-6', source: 'stream',
        },
        cache_snapshot: {
          refreshedAt: 1_786_000_001_000,
          systemTtlMs: 3_600_000,
          sessionTtlMs: 300_000,
          model: 'claude-opus-4-6',
        },
        process: [{
          type: 'compact', id: 'compact-auto-2',
          compaction: { ...compaction, id: 'compact-auto-2', trigger: 'auto' },
        }],
      }),
    })])

    expect(messages.map(message => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(messages[0]).toMatchObject({ compaction, laneId: 'subscription' })
    expect(messages[2].process?.[0]).toMatchObject({
      type: 'compact', compaction: { trigger: 'auto', preTokens: 186_000, postTokens: 42_000 },
    })
    expect(messages[2].contextSnapshot).toMatchObject({ totalTokens: 43_000, maxTokens: 200_000 })
    expect(messages[2].cacheSnapshot).toMatchObject({
      refreshedAt: 1_786_000_001_000,
      systemTtlMs: 3_600_000,
      sessionTtlMs: 300_000,
    })
  })

  it('modeOfTurns：老会话无 mode 字段一律算工作模式', () => {
    expect(modeOfTurns([turn({ id: 1 })])).toBe('work')
    expect(
      modeOfTurns([
        turn({ id: 1 }),
        turn({ id: 2, raw_json: JSON.stringify({ mode: 'chat' }) }),
      ]),
    ).toBe('chat')
  })

  it('modeOfTurns: selfhost-only history leaves cc mode selectable', () => {
    expect(
      modeOfTurns([
        turn({ id: 1, raw_json: JSON.stringify({ engine: 'selfhost' }) }),
      ]),
    ).toBe('chat')
  })

  it('metaOfTurns：老消息没有 settings / cc_session_id 时返回空', () => {
    const meta = metaOfTurns([turn({ id: 1 })])
    expect(meta.settings).toBeNull()
    expect(meta.ccSessionId).toBe('')
  })

  it('parseTurnRaw 能解开超长存根之外的正常结构', () => {
    const parsed = parseTurnRaw(
      JSON.stringify({ interrupted: true, usage: { inputTokens: 3 } }),
    )
    expect(parsed.interrupted).toBe(true)
    expect(parsed.usage).toMatchObject({ inputTokens: 3 })
    expect(parsed.process).toEqual([])
  })

  it('Pro 额度在输出前耗尽：刷新后保留用户消息并还原失败状态卡', () => {
    const messages = turnsToMessages([turn({
      id: 10,
      user_text: '最后一条不能丢',
      assistant_text: '',
      raw_json: JSON.stringify({
        engine: 'cc',
        interrupted: true,
        interrupted_reason: 'pro_limit',
      }),
    })])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', text: '最后一条不能丢' })
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      text: '',
      interrupted: true,
      interruptedReason: 'pro_limit',
      deliveryState: 'saved',
      deliveryNote: 'Pro 额度不足，未生成回复；用户消息已保存到 Haven',
    })
  })

  it('把旧 selfhost additional_context 恢复成可查看的召回模块', () => {
    const parsed = parseTurnRaw(JSON.stringify({
      recall: {
        ok: true,
        additional_context: '旧召回正文',
        recalled_ids: ['old-bucket'],
      },
    }))
    expect(parsed.recall).toMatchObject({
      injected: true,
      card_count: 1,
      chars: 5,
      modules: [{ key: 'memory_card', text: '旧召回正文' }],
    })
  })

  it('把 Haven 图片元数据恢复成私有缩略图，清除后只留占位', () => {
    const messages = turnsToMessages([turn({
      id: 9,
      user_text: '',
      attachments: [{
        id: 'image-1', session_id: 'session-1', filename: '截图.webp', mime_type: 'image/webp',
        byte_size: 1234, sha256: 'abc', cleared: false,
      }, {
        id: 'image-2', session_id: 'session-1', filename: '旧图.webp', mime_type: 'image/webp',
        byte_size: 4321, sha256: 'def', cleared: true,
      }],
    })])
    expect(messages[0].attachments?.[0].previewUrl).toContain('/api/cc-attachments/image-1')
    expect(messages[0].attachments?.[1]).toMatchObject({ cleared: true, previewUrl: undefined })
  })
})
