import { describe, expect, it } from 'vitest'
import { contextGcTest } from '../app/lib/contextGc'

describe('Context GC transcript slimming', () => {
  it('replaces only selected recoverable recall and search result content', () => {
    const rows: Array<Record<string, unknown>> = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: '用户正文\n\n<记忆召回>\n[date_recall]\n日期原文必须保留\n[/date_recall]\n[memory_card id=ombre:bucket-1#moment-1 source=direct]\ntitle: 一张卡\ntext: |\n  '
            + '很长的召回正文'.repeat(200)
            + '\n[/memory_card]\n</记忆召回>',
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'mcp__ombre__search_chat', input: { query: '那次旅行' } }],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '搜索原始结果'.repeat(500) }],
        },
      },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '助手正文必须保留' }] } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-2', name: 'mcp__ombre__breath', input: { query: '人格表现', domain: 'identity' } },
            { type: 'tool_use', id: 'tool-3', name: 'WebSearch', input: { query: 'Claude context editing', allowed_domains: ['docs.anthropic.com'] } },
            { type: 'tool_use', id: 'tool-4', name: 'WebFetch', input: { url: 'https://example.com/page', prompt: '提取实现限制' } },
            { type: 'tool_use', id: 'tool-5', name: 'Bash', input: { command: 'echo must-stay' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-2', content: 'breath 原始结果'.repeat(300) },
            { type: 'tool_result', tool_use_id: 'tool-3', content: 'WebSearch 原始结果'.repeat(300) },
            { type: 'tool_result', tool_use_id: 'tool-4', content: 'WebFetch 原始结果'.repeat(300) },
            { type: 'tool_result', tool_use_id: 'tool-5', content: 'Bash 结果必须保留' },
          ],
        },
      },
    ]
    const candidates = contextGcTest.collect(rows, new Set())
    expect(candidates.map(item => item.kind)).toEqual(['ob_recall', 'search_chat', 'breath', 'web_search', 'web_fetch'])
    const result = contextGcTest.transform(rows, new Set(candidates.map(item => item.id)))
    const serialized = JSON.stringify(rows)
    expect(result.candidateCount).toBe(5)
    expect(result.releasedTokens).toBeGreaterThan(0)
    expect(serialized).toContain('用户正文')
    expect(serialized).toContain('日期原文必须保留')
    expect(serialized).toContain('助手正文必须保留')
    expect(serialized).toContain('read_bucket(bucket_id=bucket-1)')
    expect(serialized).toContain('title: 一张卡')
    expect(serialized).toContain('曾搜索「那次旅行」')
    expect(serialized).toContain('曾调用 breath「人格表现」')
    expect(serialized).toContain('曾搜索「Claude context editing」')
    expect(serialized).toContain('曾读取 https://example.com/page')
    expect(serialized).toContain('Bash 结果必须保留')
    expect(serialized).not.toContain('搜索原始结果搜索原始结果')
  })

  it('never offers non-ombre cards and marks protected buckets', () => {
    const rows = [{
      type: 'user',
      message: {
        role: 'user',
        content: '[memory_card id=legacy-without-bucket source=unknown]\ntext: |\n  保留\n[/memory_card]\n[memory_card id=ombre:bucket-2#moment source=direct]\ntitle: 保留桶\ntext: |\n  内容\n[/memory_card]',
      },
    }]
    const candidates = contextGcTest.collect(rows, new Set(['ob:bucket-2']))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].protected).toBe(true)
  })
})
