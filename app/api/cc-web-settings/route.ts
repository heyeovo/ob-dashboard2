import { NextRequest } from 'next/server'
import { loadWebSettings, saveWebSettings } from '@/app/lib/havenPermissions'

export const runtime = 'nodejs'

export async function GET() {
  const res = await loadWebSettings()
  if (!res.ok) {
    return Response.json({ ok: false, error: res.error, settings: res.settings }, { status: 502 })
  }
  return Response.json({ ok: true, settings: res.settings })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ ok: false, error: '请求体不是对象' }, { status: 400 })
  }

  const res = await saveWebSettings(body as Record<string, unknown>)
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })
  return Response.json({ ok: true, settings: res.settings })
}
