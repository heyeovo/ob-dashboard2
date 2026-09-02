import { describe, expect, it } from 'vitest'
import { buildDisplaySegments, buildStableDisplaySegments } from '@/app/lib/cc/displaySegments'

describe('versioned assistant display segments', () => {
  it('splits ordinary paragraphs and preserves the original markdown exactly', () => {
    const source = '第一句。\n第二句。\n\n第三段。'
    const result = buildDisplaySegments(source)
    expect(result.version).toBe(2)
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

  it('keeps a bold section label and its following paragraphs together', () => {
    const source = [
      '**主动唤醒**',
      '',
      '醒来是你自己的时间。',
      '',
      '想说就说，想安静就安静。',
      '',
      '**下一节**',
      '',
      '这里是下一节。',
    ].join('\n')
    const result = buildDisplaySegments(source)
    expect(result.segments.map(item => item.markdown).join('')).toBe(source)
    expect(result.segments).toHaveLength(2)
    expect(result.segments.every(item => item.kind === 'atomic')).toBe(true)
  })

  it('withholds an unfinished streaming tail until its bubble is complete', () => {
    expect(buildStableDisplaySegments('第一颗。\n第二颗还在写', false).segments.map(item => item.markdown)).toEqual(['第一颗。\n'])
    expect(buildStableDisplaySegments('第一颗。\n第二颗写完。', true).segments.map(item => item.markdown)).toEqual(['第一颗。\n', '第二颗写完。'])
  })

  it('withholds a trailing structured block until the whole block is closed', () => {
    const list = '- 第一项\n- 第二项\n'
    expect(buildStableDisplaySegments(list, false).segments).toHaveLength(0)
    expect(buildStableDisplaySegments(list, true).segments).toHaveLength(1)
  })
})
