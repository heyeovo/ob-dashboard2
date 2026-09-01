import { describe, expect, it } from 'vitest'
import { buildDisplaySegments } from '@/app/lib/cc/displaySegments'

describe('versioned assistant display segments', () => {
  it('splits ordinary paragraphs and preserves the original markdown exactly', () => {
    const source = '第一句。\n第二句。\n\n第三段。'
    const result = buildDisplaySegments(source)
    expect(result.version).toBe(1)
    expect(result.segments.map(item => item.markdown).join('')).toBe(source)
    expect(result.segments).toHaveLength(3)
    expect(result.segments.every(item => item.kind === 'text')).toBe(true)
  })

  it('keeps code, lists, tables, quotes and heading content atomic', () => {
    const source = [
      '# 标题',
      '',
      '标题后的正文。',
      '',
      '- 一',
      '- 二',
      '',
      '```ts',
      'const value = 1',
      '```',
      '',
      '> 引用',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n')
    const result = buildDisplaySegments(source)
    expect(result.segments.map(item => item.markdown).join('')).toBe(source)
    expect(result.segments.filter(item => item.kind === 'atomic')).toHaveLength(5)
  })

  it('can promote completed streaming paragraphs without changing their text', () => {
    const firstChunk = '第一条正在说完。'
    const secondChunk = `${firstChunk}\n\n第二条刚开始`
    const completed = `${secondChunk}，现在说完。`

    expect(buildDisplaySegments(firstChunk).segments).toHaveLength(1)
    expect(buildDisplaySegments(secondChunk).segments).toHaveLength(2)
    const result = buildDisplaySegments(completed)
    expect(result.segments).toHaveLength(2)
    expect(result.segments.map(item => item.markdown).join('')).toBe(completed)
  })
})
