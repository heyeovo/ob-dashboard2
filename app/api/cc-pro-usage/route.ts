import { NextRequest } from 'next/server'
import { getProUsage } from '@/app/lib/ccSession'

// 只读取当前已存在的 Pro SDK session，不启动新 query、不触发模型调用。
// SDK 接口仍标记为 experimental；失效时返回 available=false，不估算百分比。
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const sessionId = String(request.nextUrl.searchParams.get('session_id') || '').trim()
  if (!sessionId) {
    return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  }
  return Response.json({ ok: true, usage: await getProUsage(sessionId) })
}
