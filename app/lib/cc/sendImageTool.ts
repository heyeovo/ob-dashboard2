import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { open } from 'node:fs/promises'
import sharp from 'sharp'
import { z } from 'zod'
import { YANZHI_FILES_ROOT } from '@/app/lib/artifactMeta'
import { uploadAttachment } from '@/app/lib/havenAttachments'
import { safeTarget } from './yanzhiFilesPath'
import { downloadImage } from './sendImageDownload'
import { SEND_IMAGE_REMINDER } from './sendImageResult'

const INPUT = { url: z.string().optional(), path: z.string().optional(), caption: z.string().max(200).optional() }
const schema = z.object(INPUT).refine(input => (input.url !== undefined) !== (input.path !== undefined) && Boolean((input.url ?? input.path)?.trim()), 'url 和 path 必须二选一')
const DESCRIPTION = "Send an image into the chat so she sees it inline. Pass url (direct image or a web page — its og:image is used) or path (an image/SVG in yanzhi's files). You get a thumbnail back: check it is the right picture before talking about it. Use for things worth showing (exercise demos, things you drew), not decoration."

export async function executeSendImage(input: z.infer<typeof schema>, sessionId: string, root = YANZHI_FILES_ROOT) {
  try {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new Error('url 和 path 必须二选一，caption 不超过 200 字')
    let bytes: Buffer
    if (input.path) {
      const { target } = await safeTarget(root, input.path)
      if (!/\.(svg|png|jpe?g|webp|gif)$/i.test(target)) throw new Error('不是支持的图片文件')
      const file = await open(target, 'r')
      try {
        const info = await file.stat()
        if (!info.isFile()) throw new Error('path 必须是图片文件')
        if (info.size > 10 * 1024 * 1024) throw new Error('图片太大（超过 10 MB）')
        const buffer = Buffer.alloc(10 * 1024 * 1024 + 1)
        let size = 0
        while (size < buffer.length) {
          const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
          if (!bytesRead) break
          size += bytesRead
        }
        if (size > 10 * 1024 * 1024) throw new Error('图片太大（超过 10 MB）')
        bytes = buffer.subarray(0, size)
      } finally { await file.close() }
    } else bytes = await downloadImage(input.url!)
    let image: { data: Buffer; info: sharp.OutputInfo }
    try {
      image = await sharp(bytes, { density: 192, animated: false, limitInputPixels: 40_000_000 })
        .rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
    } catch { throw new Error('不是图片，或图片无法解码') }
    const thumbnail = await sharp(image.data).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
    const uploaded = await uploadAttachment({ sessionId, filename: 'send-image.webp', bytes: Uint8Array.from(image.data).buffer, mimeType: 'image/webp', kind: 'image', origin: 'assistant' })
    if (!uploaded.ok || !uploaded.attachment) throw new Error('图片保存失败，请稍后重试')
    return { content: [
      { type: 'image' as const, data: thumbnail.toString('base64'), mimeType: 'image/webp' },
      { type: 'text' as const, text: `已发送图片 [attachment:${uploaded.attachment.id}] ${image.info.width}×${image.info.height}\n${input.url || input.path}${input.caption ? `\n${input.caption}` : ''}\n${SEND_IMAGE_REMINDER}` },
    ] }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const reason = code === 'ENOENT' ? '图片文件不存在' : error instanceof Error ? error.message : '发送图片失败'
    return { isError: true, content: [{ type: 'text' as const, text: reason.startsWith('path') || /图片|网页|地址|超时|caption|url|重定向/.test(reason) ? reason : '图片下载或读取失败' }] }
  }
}
export function sendImageMcpModelSurface() {
  return { name: 'send_image', version: '1.0.0', alwaysLoad: true, tools: [{ name: 'send_image', description: DESCRIPTION, alwaysLoad: true, inputSchema: z.toJSONSchema(z.object(INPUT)) }] }
}
export function createSendImageMcpServer(sessionId: string) {
  return createSdkMcpServer({ name: 'send_image', version: '1.0.0', alwaysLoad: true,
    tools: [tool('send_image', DESCRIPTION, INPUT, args => executeSendImage(args, sessionId), { alwaysLoad: true })] })
}
