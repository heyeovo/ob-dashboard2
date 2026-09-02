import { NextRequest, NextResponse } from 'next/server'
import {
  enqueueBarkTest,
  getBarkNotifications,
  patchBarkNotifications,
} from '@/app/lib/havenTurns'

export const runtime = 'nodejs'

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function GET(request: NextRequest) {
  const sessionId = String(request.nextUrl.searchParams.get('session_id') || '').trim()
  const laneId = String(request.nextUrl.searchParams.get('lane_id') || '').trim()
  if ((sessionId && !laneId) || (!sessionId && laneId)) return error('session_id / lane_id 必须同时提供')
  const result = await getBarkNotifications({ sessionId, laneId })
  return result.ok
    ? NextResponse.json({ ok: true, config: result.config, recent: result.recent })
    : error(result.error || '读取 Bark 通知设置失败', result.httpStatus || 502)
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const changes = body?.changes && typeof body.changes === 'object'
    ? body.changes as Record<string, unknown>
    : null
  if (!changes) return error('缺少 changes')
  const result = await patchBarkNotifications(changes)
  return result.ok
    ? NextResponse.json({ ok: true, config: result.config })
    : error(result.error || '保存 Bark 通知设置失败', result.httpStatus || 502)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (String(body?.action || '') !== 'test') return error('不支持的操作')
  const result = await enqueueBarkTest()
  return result.ok
    ? NextResponse.json({ ok: true, queued: result.queued })
    : error(result.error || '测试推送入队失败', result.httpStatus || 502)
}
