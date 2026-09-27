import { NextRequest } from 'next/server'
import { normalizeAppearance } from '@/app/lib/appearance'
import { appearanceConnection, loadAppearance } from '@/app/lib/havenAppearance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await loadAppearance()
  return Response.json(
    { ok: result.fromHaven, appearance: result.appearance },
    { status: result.fromHaven ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return Response.json({ ok: false, error: '外观配置格式错误' }, { status: 400 })
  }
  try {
    const { url, token } = appearanceConnection()
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appearance: normalizeAppearance(input) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return Response.json({ ok: false, error: '外观设置保存失败' }, { status: 502 })
    const body = await response.json() as { appearance?: unknown }
    return Response.json({ ok: true, appearance: normalizeAppearance(body.appearance) })
  } catch {
    return Response.json({ ok: false, error: 'Haven 暂时不可用' }, { status: 502 })
  }
}
