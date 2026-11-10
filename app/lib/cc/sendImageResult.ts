export const SEND_IMAGE_TOOL = 'mcp__send_image__send_image'
export const SEND_IMAGE_REMINDER = '看一眼缩略图，不对就在回复里说明，别假装是对的'

export function parseSentImage(result: string | undefined) {
  // CC ≥2.1.3xx 会在 MCP 图片结果前自动插一行「[Image: source: …]」，所以按行找，不要求在开头。
  const match = /(?:^|\n)已发送图片 \[attachment:([a-zA-Z0-9_-]+)\] (\d+)×(\d+)\r?\n/.exec(result || '')
  if (!match) return null
  const lines = result!.slice(match.index + match[0].length).split(/\r?\n/)
  return { attachmentId: match[1], width: Number(match[2]), height: Number(match[3]), source: lines[0], caption: lines.slice(1).filter(line => line !== SEND_IMAGE_REMINDER).join('\n').trim() }
}
