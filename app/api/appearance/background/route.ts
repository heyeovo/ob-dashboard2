import { NextRequest } from 'next/server'
import { appearanceConnection } from '@/app/lib/havenAppearance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PATH = '/gateway/api/cc/appearance/background'
const MAX_BYTES = 5 * 1024 * 1024

export async function GET(request: NextRequest) {
  try {
    const assetId = request.nextUrl.searchParams.get('assetId')
    const { url, token } = appearanceConnection(PATH)
    const target = new URL(url)
    if (assetId) target.searchParams.set('assetId', assetId)
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 })
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return Response.json({ ok: false, error: '请选择 JPEG、PNG 或 WebP 图片' }, { status: 400 })
    }
    if (!file.size || file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: '图片不能超过 5 MB' }, { status: 413 })
    }
    const outbound = new FormData()
    outbound.append('file', file, file.name)
    const { url, token } = appearanceConnection(PATH)
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: outbound,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    const body = await response.json() as { assetId?: string; error?: string }
    if (!response.ok || !body.assetId) {
      return Response.json({ ok: false, error: body.error || '背景图上传失败' }, { status: response.status < 500 ? response.status : 502 })
    }
    return Response.json({ ok: true, assetId: body.assetId })
  } catch {
    return Response.json({ ok: false, error: '背景图上传失败' }, { status: 502 })
  }
}

export async function DELETE() {
  try {
    const { url, token } = appearanceConnection(PATH)
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return Response.json({ ok: false, error: '背景图删除失败' }, { status: 502 })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false, error: 'Haven 暂时不可用' }, { status: 502 })
  }
}
