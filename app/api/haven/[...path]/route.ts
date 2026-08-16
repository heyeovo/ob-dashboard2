import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from '../../../lib/api'
import { getHavenBaseUrl, joinHavenUrl } from '../../../lib/havenConfig'

/**
 * 画像（Portrait / Profile）dashboard API 的 catch-all 代理。
 *
 * 这些接口全在 Haven server.py 直连（不经 /gateway/*），鉴权走看板登录 cookie。
 * 照 app/api/care/[...path]/route.ts 的模式，但补了 PUT / DELETE 导出：
 *   - PUT    /api/portrait-state/stable
 *   - DELETE /api/portrait-state/items
 *   - DELETE /api/profile-facts/{id}
 * 白名单允许最多三段路径（portrait-state/stable/lock、profile-facts/{id}）。
 */
const ALLOWED_PATH =
  /^(portrait-state|portrait-maintain|profile-facts|profile-fact-proposals|anchor-proposals)(\/[^/]+){0,2}$/

async function relay(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const upstreamPath = path.map(decodeURIComponent).join('/')
  if (!ALLOWED_PATH.test(upstreamPath)) {
    return NextResponse.json({ error: 'Unsupported haven endpoint' }, { status: 404 })
  }

  try {
    const cookie = await getSessionCookie()
    const query = req.nextUrl.search
    const body = req.method === 'GET' ? undefined : await req.text()
    const res = await fetch(`${joinHavenUrl(getHavenBaseUrl(), `/api/${upstreamPath}`)}${query}`, {
      method: req.method,
      headers: {
        Cookie: cookie,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })
    const responseBody = await res.text()
    const contentType = res.headers.get('content-type')
    return new NextResponse(responseBody, {
      status: res.status,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 })
  }
}

export const GET = relay
export const POST = relay
export const PUT = relay
export const PATCH = relay
export const DELETE = relay
