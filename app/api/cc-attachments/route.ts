import { NextRequest } from 'next/server'
import { clearAttachment, uploadAttachment } from '@/app/lib/havenAttachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const sessionId = String(form?.get('session_id') || '').trim()
  const file = form?.get('image')
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  if (!(file instanceof File)) return Response.json({ ok: false, error: '请选择图片' }, { status: 400 })
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
    return Response.json({ ok: false, error: '压缩后的图片不能超过 2MB' }, { status: 413 })
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return Response.json({ ok: false, error: '只支持 JPEG、PNG、WebP 图片' }, { status: 400 })
  }
  const result = await uploadAttachment({
    sessionId,
    filename: file.name,
    bytes: await file.arrayBuffer(),
    mimeType: file.type,
  })
  return Response.json(
    { ok: result.ok, attachment: result.attachment, error: result.error || undefined },
    { status: result.ok ? 200 : result.status },
  )
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as { session_id?: string; all?: boolean } | null
  const sessionId = String(body?.session_id || '').trim()
  if (!sessionId || body?.all !== true) {
    return Response.json({ ok: false, error: '清除本窗口图片需要 session_id 和 all=true' }, { status: 400 })
  }
  const result = await clearAttachment({ sessionId, all: true })
  return Response.json({ ok: result.ok, error: result.error || undefined }, { status: result.ok ? 200 : result.status })
}
