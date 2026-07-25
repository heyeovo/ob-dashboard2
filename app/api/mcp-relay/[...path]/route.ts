import { NextRequest } from 'next/server'

/**
 * MCP 中转路由。
 *
 * 浏览器无法直连大多数 MCP 服务（对方不返回 CORS 头，预检就被拦掉），
 * 所以让服务端替浏览器转发。用法是把目标主机当成第一段路径写进 URL：
 *
 *   https://<本站>/api/mcp-relay/mcp.tavily.com/mcp/?tavilyApiKey=tvly-xxx
 *   → https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-xxx
 *
 * query string 原样带过去，所以放在 URL 里的 key 不需要额外转义。
 *
 * 这本质上是一个 URL 转发器，不限制目标就等于把本站变成公开跳板机，
 * 所以只允许白名单里的主机。加新服务改 MCP_RELAY_ALLOWED_HOSTS 环境变量
 * （逗号分隔），不用改代码。
 */

const DEFAULT_ALLOWED_HOSTS = ['mcp.tavily.com']

function allowedHosts(): string[] {
  const configured = (process.env.MCP_RELAY_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return configured.length ? configured : DEFAULT_ALLOWED_HOSTS
}

function isHostAllowed(host: string): boolean {
  const target = host.toLowerCase()
  return allowedHosts().some(
    (allowed) => target === allowed || target.endsWith(`.${allowed}`),
  )
}

// 转发给上游的请求头。MCP 的会话是靠 Mcp-Session-Id 维持的，漏一个就断。
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'authorization',
  'x-api-key',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
]

type TargetResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number }

function buildTargetUrl(segments: string[], search: string): TargetResult {
  const [host, ...rest] = segments
  if (!host) {
    return { ok: false, error: 'Missing target host in path', status: 400 }
  }
  if (!isHostAllowed(host)) {
    return { ok: false, error: `Host not allowed: ${host}`, status: 403 }
  }
  const path = rest.length ? `/${rest.join('/')}` : '/'
  return { ok: true, url: `https://${host}${path}${search}` }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-api-key, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, Accept',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
  }
}

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

async function relay(
  req: NextRequest,
  segments: string[],
  method: 'GET' | 'POST' | 'DELETE',
) {
  const target = buildTargetUrl(segments, req.nextUrl.search)
  if (!target.ok) {
    return errorResponse(target.error, target.status)
  }

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/event-stream')
  }

  const body = method === 'POST' ? await req.text() : undefined

  try {
    const upstream = await fetch(target.url, {
      method,
      headers,
      body,
      // 上游可能返回长连 SSE，不要让 fetch 缓存或缓冲
      cache: 'no-store',
    })

    const responseHeaders: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(),
    }
    // 会话 id 必须回给浏览器，否则后续请求全部被上游当成新会话
    const sessionId = upstream.headers.get('mcp-session-id')
    if (sessionId) responseHeaders['Mcp-Session-Id'] = sessionId
    const protocolVersion = upstream.headers.get('mcp-protocol-version')
    if (protocolVersion) responseHeaders['MCP-Protocol-Version'] = protocolVersion

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (e) {
    return errorResponse(`MCP relay failed: ${String(e)}`, 502)
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return relay(req, path, 'GET')
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return relay(req, path, 'POST')
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return relay(req, path, 'DELETE')
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(), 'Access-Control-Max-Age': '86400' },
  })
}
