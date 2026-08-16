import { NextRequest, NextResponse } from 'next/server'
import { getHavenBaseUrl, getSessionCookie } from '../../lib/api'

export async function GET(req: NextRequest) {
  // Forward all query params transparently — needed for simulate, include_vector, limit, etc.
  // 透传全部 query 参数给后端
  const backendUrl = `${getHavenBaseUrl()}/api/search?${new URL(req.url).searchParams.toString()}`
  try {
    const cookie = await getSessionCookie()
    const res = await fetch(backendUrl, {
      headers: { Cookie: cookie },
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
