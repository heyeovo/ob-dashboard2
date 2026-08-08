import { NextRequest } from 'next/server'
import { clearAttachment, fetchAttachmentResponse } from '@/app/lib/havenAttachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: RouteContext<'/api/cc-attachments/[id]'>) {
  const { id } = await context.params
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  const upstream = await fetchAttachmentResponse(id, sessionId)
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '')
    return new Response(body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' } })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function DELETE(request: NextRequest, context: RouteContext<'/api/cc-attachments/[id]'>) {
  const { id } = await context.params
  const body = await request.json().catch(() => null) as { session_id?: string } | null
  const sessionId = String(body?.session_id || '').trim()
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  const result = await clearAttachment({ attachmentId: id, sessionId })
  return Response.json({ ok: result.ok, error: result.error || undefined }, { status: result.ok ? 200 : result.status })
}
