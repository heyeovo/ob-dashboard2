import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { uploadAttachment } from '@/app/lib/havenAttachments'

export const runtime = 'nodejs'

const MAX_IMAGES = 9
const MAX_BYTES_PER_IMAGE = 10 * 1024 * 1024
const XHS_MAX_EDGE = 600
const XHS_QUALITY = 70

type ImageResult = { url: string; base64: string; mime: string; attachmentId?: string }
type ImageError = { url: string; error: string }

async function compressImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(XHS_MAX_EDGE, XHS_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: XHS_QUALITY })
    .toBuffer()
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const urls = body.urls
  if (!Array.isArray(urls) || urls.length === 0) {
    return Response.json({ ok: false, error: 'urls 必须是非空数组' }, { status: 400 })
  }

  const sessionId = String(body.session_id || '').trim()

  const limited = urls.slice(0, MAX_IMAGES).map(String).filter(u => u.startsWith('http'))
  if (limited.length === 0) {
    return Response.json({ ok: false, error: '没有有效的图片 URL' }, { status: 400 })
  }

  const results = await Promise.all(
    limited.map(async (url, index): Promise<ImageResult | ImageError> => {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
            Referer: 'https://www.xiaohongshu.com/',
          },
        })
        if (!response.ok) return { url, error: `HTTP ${response.status}` }

        const contentLength = Number(response.headers.get('content-length') || 0)
        if (contentLength > MAX_BYTES_PER_IMAGE) return { url, error: '图片过大' }

        const raw = Buffer.from(await response.arrayBuffer())
        if (raw.byteLength > MAX_BYTES_PER_IMAGE) return { url, error: '图片过大' }

        const compressed = await compressImage(raw)
        const mime = 'image/webp'
        const base64 = compressed.toString('base64')

        let attachmentId: string | undefined
        if (sessionId) {
          const result = await uploadAttachment({
            sessionId,
            filename: `xhs-image-${index + 1}.webp`,
            bytes: new Uint8Array(compressed).buffer as ArrayBuffer,
            mimeType: mime,
            kind: 'image',
          })
          if (result.ok && result.attachment) {
            attachmentId = result.attachment.id
          }
        }

        return { url, base64, mime, attachmentId }
      } catch (error) {
        return { url, error: error instanceof Error ? error.message : '下载失败' }
      }
    }),
  )

  const images = results.filter((r): r is ImageResult => 'base64' in r)
  const errors = results.filter((r): r is ImageError => 'error' in r)

  return Response.json({
    ok: true,
    images,
    errors: errors.length > 0 ? errors : undefined,
  })
}
