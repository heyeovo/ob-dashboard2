import { describe, expect, it } from 'vitest'
import { composeWindowPersonaAppend, fixedWindowAppend } from '@/app/lib/cc/windowPrompt'

function session(overrides: Record<string, unknown> = {}) {
  return {
    handoff_snapshot: {},
    daily_review_enabled: false,
    daily_review_snapshot: [],
    ...overrides,
  } as never
}

describe('CC window prompt boundary', () => {
  it('uses handoff as the only fixed background for current windows', () => {
    const fixed = fixedWindowAppend(session({
      handoff_snapshot: { content: '<window_handoff_snapshot>固定内容</window_handoff_snapshot>' },
      daily_review_enabled: true,
      daily_review_snapshot: [{ review_date: '2026-09-01', content: '旧日回顾字段' }],
    }))
    expect(fixed).toContain('固定内容')
    expect(fixed).not.toContain('旧日回顾字段')
  })

  it('falls back to the legacy daily review only when handoff is absent', () => {
    const fixed = fixedWindowAppend(session({
      daily_review_enabled: true,
      daily_review_snapshot: [{ review_date: '2026-09-01', content: '历史窗口日回顾' }],
    }))
    expect(fixed).toContain('<daily_review_snapshot>')
    expect(fixed).toContain('历史窗口日回顾')
  })

  it('recomposes the latest dynamic persona around the same fixed handoff', () => {
    const state = session({
      handoff_snapshot: { content: '<window_handoff_snapshot>固定内容</window_handoff_snapshot>' },
      frozen_persona_append: '旧整串：基础 system + 旧提示词 + handoff',
    })
    const before = composeWindowPersonaAppend('旧协作者提示词', state, 'session-1')
    const after = composeWindowPersonaAppend('新协作者提示词', state, 'session-1')
    expect(before).toContain('旧协作者提示词')
    expect(after).toContain('新协作者提示词')
    expect(after).not.toContain('旧协作者提示词')
    expect(after).not.toContain('旧整串')
    expect(after).toContain('<window_handoff_snapshot>固定内容</window_handoff_snapshot>')
    expect(after).toContain('当前会话 session_id：session-1')
  })
})
