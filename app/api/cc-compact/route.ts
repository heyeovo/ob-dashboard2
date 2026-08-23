import { NextRequest } from 'next/server'
import { compactSession } from '@/app/lib/ccSession'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { session_id?: string }
  const sessionId = String(body.session_id || '').trim()
  if (!sessionId) {
    return Response.json({ ok: false, error: '缺少 session_id' }, { status: 400 })
  }
  const result = await compactSession(sessionId)
  return Response.json(result, { status: result.ok ? 200 : 409 })
}
