import { NextRequest } from 'next/server'
import { clearAttachment, uploadAttachment } from '@/app/lib/havenAttachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const sessionId = String(form?.get('session_id') || '').trim()
  const image = form?.get('image')
  const document = form?.get('file')
  const file = image instanceof File ? image : document
  const kind = image instanceof File ? 'image' : 'file'
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  if (!(file instanceof File)) return Response.json({ ok: false, error: '请选择图片或文件' }, { status: 400 })
  if (kind === 'image') {
    if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
      return Response.json({ ok: false, error: '压缩后的图片不能超过 2MB' }, { status: 413 })
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return Response.json({ ok: false, error: '只支持 JPEG、PNG、WebP 图片' }, { status: 400 })
    }
  } else {
    const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
      return Response.json({ ok: false, error: '文件不能超过 4MB' }, { status: 413 })
    }
    if (!['pdf', 'docx', 'md', 'markdown', 'txt', 'csv'].includes(extension)) {
      return Response.json({ ok: false, error: '只支持 PDF、DOCX、MD、TXT、CSV 文件' }, { status: 400 })
    }
  }
  const result = await uploadAttachment({
    sessionId,
    filename: file.name,
    bytes: await file.arrayBuffer(),
    mimeType: file.type,
    kind,
    textContent: kind === 'file' ? String(form?.get('text_content') || '') : '',
    textTruncated: kind === 'file' && String(form?.get('text_truncated') || '') === '1',
  })
  return Response.json(
    { ok: result.ok, attachment: result.attachment, error: result.error || undefined },
    { status: result.ok ? 200 : result.status },
  )
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    session_id?: string
    all?: boolean
    kind?: 'image' | 'file'
  } | null
  const sessionId = String(body?.session_id || '').trim()
  if (!sessionId || body?.all !== true || !['image', 'file'].includes(String(body?.kind || ''))) {
    return Response.json({ ok: false, error: '分类清除需要 session_id、kind 和 all=true' }, { status: 400 })
  }
  const result = await clearAttachment({ sessionId, all: true, kind: body?.kind })
  return Response.json(
    { ok: result.ok, cleared: result.cleared, error: result.error || undefined },
    { status: result.ok ? 200 : result.status },
  )
}
