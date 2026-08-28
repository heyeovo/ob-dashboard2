import { describe, expect, it } from 'vitest'
import {
  buildHandoffSnapshot,
  estimateHandoffTokens,
  handoffSnapshotContent,
} from '@/app/lib/cc/handoffSnapshot'

describe('handoff snapshot', () => {
  it('uses one stable formatter for selected modules', () => {
    const snapshot = buildHandoffSnapshot([
      { kind: 'pinned', id: 'p1', title: '钉选', content: '长期背景' },
      { kind: 'journal', id: 'j1', title: '今天', content: '日记正文' },
      { kind: 'chat', id: 't1', title: '第 1 轮', content: '小羊：你好\nOmbre：你好' },
    ])
    expect(snapshot.content).toContain('【钉选记忆｜钉选】')
    expect(snapshot.content).toContain('【日记｜今天】')
    expect(snapshot.content).toContain('【旧窗口对话｜第 1 轮】')
    expect(handoffSnapshotContent(snapshot)).toBe(snapshot.content)
    expect(snapshot.stats.selected_estimated_tokens).toBeGreaterThan(0)
  })

  it('keeps explicit items and newest chat turns when over budget', () => {
    const snapshot = buildHandoffSnapshot([
      { kind: 'pinned', id: 'p1', title: '钉选', content: '固定' },
      { kind: 'chat', id: 'old', title: '旧', content: '旧'.repeat(80) },
      { kind: 'chat', id: 'new', title: '新', content: '新'.repeat(20) },
    ], { budgetTokens: 150 })
    expect(snapshot.stats.over_budget).toBe(true)
    expect(snapshot.items.map(item => item.id)).toContain('p1')
    expect(snapshot.items.map(item => item.id)).toContain('new')
    expect(snapshot.items.map(item => item.id)).not.toContain('old')
    expect(snapshot.stats.effective_estimated_tokens).toBeLessThanOrEqual(150)
  })

  it('uses a conservative shared estimate', () => {
    expect(estimateHandoffTokens('中文')).toBeGreaterThan(estimateHandoffTokens('ab'))
  })
})
