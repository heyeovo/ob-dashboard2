import { getHavenBaseUrl, getHavenGatewayToken, joinHavenUrl } from '@/app/lib/havenConfig'
import { kickTrpgTurn, type TrpgTrigger } from '@/app/lib/trpg/scheduler'

type Context = { params: Promise<{ path: string[] }> }
const id = '[A-Za-z0-9_-]+'
const reads = new RegExp(`^(modules|modules/${id}/pregens|games|games/${id}/table)$`)
const writes = new RegExp(`^(modules|games|games/${id}/(action|table-talk|settle)|games/${id}/checks/${id}/roll)$`)

async function forward(request: Request, { params }: Context) {
  const { path } = await params
  const target = path.join('/')
  // Validate decoded segments before URL construction; phase and arbitrary paths stay private.
  if (path.some(part => !/^[A-Za-z0-9_-]+$/.test(part))
    || !(request.method === 'GET' ? reads : writes).test(target)) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  try {
    const url = new URL(joinHavenUrl(getHavenBaseUrl(), `/trpg/api/${target}`))
    if (request.method === 'GET' && path.at(-1) === 'table') {
      const cursor = new URL(request.url).searchParams.get('since_seq')
      if (cursor !== null) url.searchParams.set('since_seq', cursor)
    }
    const upstream = await fetch(url, {
      method: request.method,
      headers: { Authorization: `Bearer ${getHavenGatewayToken()}`, 'Content-Type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined,
      cache: 'no-store',
      redirect: 'error',
    })
    const body = await upstream.text()
    if (upstream.ok && request.method === 'POST' && path[0] === 'games' && path.length > 2) {
      await kickTrpgTurn(path[1], path.at(-1) as TrpgTrigger)
    }
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch {
    return Response.json({ error: '跑团服务暂时不可用，请稍后重试' }, { status: 502 })
  }
}

export const GET = forward
export const POST = forward
