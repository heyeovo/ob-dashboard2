import { describe, expect, it } from 'vitest'
import { parseForwardedMessage } from '@/app/cc/forwardedMessage'

describe('parseForwardedMessage', () => {
  it('把持久化的转发块拆成卡片内容与用户正文', () => {
    expect(parseForwardedMessage(
      '<转发的消息 来源="小言·第一段故事">\n[04-03 11:35] 小羊: 第一条\n---\n[04-03 11:36] 言之: 第二条\n</转发的消息>\n\n这是我自己输入的',
    )).toEqual({
      title: '小言·第一段故事',
      lines: ['[04-03 11:35] 小羊: 第一条', '[04-03 11:36] 言之: 第二条'],
      userText: '这是我自己输入的',
    })
  })

  it('支持只转发、不追加正文', () => {
    expect(parseForwardedMessage(
      '<转发的消息 来源="窗口 3">\n一条消息\n</转发的消息>\n\n',
    )).toMatchObject({ title: '窗口 3', lines: ['一条消息'], userText: '' })
  })

  it('格式不完整时不误吞普通用户消息', () => {
    expect(parseForwardedMessage('普通消息')).toBeNull()
    expect(parseForwardedMessage('<转发的消息 来源="坏格式">\n没有结束标签')).toBeNull()
  })
})
