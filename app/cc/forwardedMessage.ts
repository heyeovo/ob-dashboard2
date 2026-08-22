export type ParsedForwardedMessage = {
  title: string
  lines: string[]
  userText: string
}

const OPEN_PREFIX = '<转发的消息 来源="'
const OPEN_SUFFIX = '">\n'
const CLOSE_TAG = '\n</转发的消息>'

/**
 * 转发内容仍作为用户消息的一部分保存和发给模型；这里只负责把界面显示拆回卡片 + 正文。
 * 格式不完整时返回 null，旧消息继续按普通正文显示，不能误吞用户输入。
 */
export function parseForwardedMessage(text: string): ParsedForwardedMessage | null {
  if (!text.startsWith(OPEN_PREFIX)) return null

  const titleEnd = text.indexOf(OPEN_SUFFIX, OPEN_PREFIX.length)
  if (titleEnd === -1) return null
  const contentStart = titleEnd + OPEN_SUFFIX.length
  const contentEnd = text.indexOf(CLOSE_TAG, contentStart)
  if (contentEnd === -1) return null

  const title = text.slice(OPEN_PREFIX.length, titleEnd).trim() || '历史聊天'
  const forwardedText = text.slice(contentStart, contentEnd)
  const remainder = text.slice(contentEnd + CLOSE_TAG.length)
  const userText = remainder.replace(/^\r?\n\r?\n/, '')
  const lines = forwardedText
    .split(/\r?\n---\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null
  return { title, lines, userText }
}
