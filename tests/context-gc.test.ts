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
    expect(serialized).toContain('召回内容已清理：一张卡（bucket-1）')
    expect(serialized).toContain('已清理：曾搜索「那次旅行」')
    expect(serialized).toContain('已清理：breath「人格表现」')
    expect(serialized).toContain('已清理：曾搜索「Claude context editing」')
    expect(serialized).toContain('已清理：曾读取「https://example.com/page」')
    expect(serialized).toContain('Bash 结果必须保留')
    expect(serialized).not.toContain('搜索原始结果搜索原始结果')
  })

  it('slims artifact page writes and reads but keeps patches and other files', () => {
    const page = '<html><head><title>下雨天</title></head><body>' + '雨'.repeat(3000) + '</body></html>'
    const rows: Array<Record<string, unknown>> = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'a-1', name: 'mcp__yanzhi__files', input: { action: 'write', path: 'artifacts/rain.html', content: page } },
            { type: 'tool_use', id: 'a-2', name: 'Write', input: { file_path: '/data/cc-chat-files/artifacts/snow.html', content: page } },
            { type: 'tool_use', id: 'a-3', name: 'Read', input: { file_path: '/data/cc-chat-files/artifacts/rain.html' } },
            { type: 'tool_use', id: 'a-4', name: 'mcp__yanzhi__files', input: { action: 'patch', path: 'artifacts/rain.html', old_text: '雨', new_text: '雪' } },
            { type: 'tool_use', id: 'a-5', name: 'Write', input: { file_path: '/workspace/dashboard/x.html', content: '代码文件必须保留' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'a-1', content: '已写入 artifacts/rain.html' },
            { type: 'tool_result', tool_use_id: 'a-2', content: 'File created' },
            { type: 'tool_result', tool_use_id: 'a-3', content: [{ type: 'text', text: '1\t' + page }] },
            { type: 'tool_result', tool_use_id: 'a-4', content: '已修改 artifacts/rain.html' },
            { type: 'tool_result', tool_use_id: 'a-5', content: 'File created' },
          ],
        },
      },
    ]
    const candidates = contextGcTest.collect(rows, new Set())
    expect(candidates.map(item => item.kind)).toEqual(['artifact_write', 'artifact_write', 'artifact_read'])
    expect(candidates[0].label).toBe('写入 artifacts/rain.html「下雨天」')
    const result = contextGcTest.transform(rows, new Set(candidates.map(item => item.id)))
    expect(result.candidateCount).toBe(3)
    expect(result.counts.artifact_write).toBe(2)
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain('雨雨雨')
    expect(serialized).toContain(`已清理：写入 artifacts/rain.html · 下雨天 · ${page.length} 字`)
    expect(serialized).toContain('已清理：曾读取 artifacts/rain.html')
    expect(serialized).toContain('代码文件必须保留')
    expect(serialized).toContain('"new_text":"雪"')
    expect(contextGcTest.collect(rows, new Set()).every(item => item.cleared)).toBe(true)
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
