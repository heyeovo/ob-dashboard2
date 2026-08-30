import { NextRequest } from 'next/server'
import { getProUsage } from '@/app/lib/ccSession'
import { loadProUsageSnapshot, saveProUsageSnapshot } from '@/app/lib/havenProUsage'

// 只读取当前已存在的 Pro SDK session，不启动新 query、不触发模型调用。
// SDK 接口仍标记为 experimental；失效时返回 available=false，不估算百分比。
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const sessionId = String(request.nextUrl.searchParams.get('session_id') || '').trim()
  if (!sessionId) {
    return Response.json({ ok: false, error: 'session_id 不能为空' }, { status: 400 })
  }
  const liveUsage = await getProUsage(sessionId)
  if (liveUsage.available && !liveUsage.stale && liveUsage.updatedAt) {
    // 持久化失败不影响本次实时额度显示；下次轮询会继续尝试覆盖同一条记录。
    await saveProUsageSnapshot(liveUsage)
    return Response.json({ ok: true, usage: liveUsage })
  }
  const persisted = await loadProUsageSnapshot()
  if (persisted.ok && persisted.snapshot?.available) {
    return Response.json({
      ok: true,
      usage: {
        ...persisted.snapshot,
        stale: true,
        note: liveUsage.note || '当前没有在线 Pro 会话，显示上次读取值',
      },
    })
  }
  return Response.json({ ok: true, usage: liveUsage })
}
