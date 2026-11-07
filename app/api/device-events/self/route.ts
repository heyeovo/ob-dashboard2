import { cookies } from 'next/headers'
import { DASHBOARD_SESSION_COOKIE, getDashboardAuthConfig, verifyDashboardSession } from '../../../lib/dashboardAuth'
import { forwardDeviceEvents, readDeviceBody } from '../../../lib/deviceEvents'

export async function POST(request: Request) {
  const auth = getDashboardAuthConfig()
  const jar = await cookies()
  if (!auth.configured || !verifyDashboardSession(jar.get(DASHBOARD_SESSION_COOKIE)?.value, auth.sessionSecret)) {
    return Response.json({ error: '请先登录' }, { status: 401 })
  }
  try {
    const raw = await readDeviceBody(request) as Record<string, unknown>
    if (!raw || !['opened', 'closed'].includes(String(raw.event))) {
      return Response.json({ error: '事件格式无效' }, { status: 400 })
    }
    return forwardDeviceEvents({ event_id: raw.event_id, occurred_at: raw.occurred_at,
      event: raw.event, app_id: 'home', app_name: '我们家', source: 'pwa' })
  } catch (error) {
    const large = error instanceof Error && error.message === '请求过大'
    return Response.json({ error: large ? '请求过大' : '事件格式无效' }, { status: large ? 413 : 400 })
  }
}
