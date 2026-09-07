import { describe, expect, it } from 'vitest'
import { estimateTextTokens, splitRecallModules } from '@/app/lib/recallDisplay'

describe('recall display metrics', () => {
  it('separates the full injection estimate from card-body estimates', () => {
    const context = [
      '[memory_card id=ombre:a source=direct]',
      'title: 第一次约会',
      'text: |',
      '  那天一起看了电影。',
      '[/memory_card]',
    ].join('\n')
    const modules = splitRecallModules(context, 1)
    expect(modules).toHaveLength(1)
    expect(modules[0].estimated_tokens).toBe(estimateTextTokens(modules[0].text))
    expect(estimateTextTokens(context)).toBeGreaterThan(modules[0].estimated_tokens)
  })

  it('keeps old untagged recall payloads visible as one module', () => {
    expect(splitRecallModules('召回背景', 1)).toMatchObject([
      { key: 'memory_card', card_count: 1, text: '召回背景' },
    ])
  })
})
