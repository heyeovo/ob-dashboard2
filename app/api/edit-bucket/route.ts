import { NextRequest, NextResponse } from 'next/server'

const MCP_URL = 'https://forxiaoyan.zeabur.app/mcp'

async function getMcpSession() {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ob-dashboard', version: '1.0' } }
    })
  })
  return res.headers.get('mcp-session-id')
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, content, pinned, resolved, digested, tags, delete: del } = body

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const sessionId = await getMcpSession()
  if (!sessionId) return NextResponse.json({ error: 'failed to get session' }, { status: 500 })

  const args: Record<string, unknown> = { bucket_id: id }
  if (content !== undefined) args.content = content
  if (pinned !== undefined) args.pinned = pinned
  if (resolved !== undefined) args.resolved = resolved
  if (digested !== undefined) args.digested = digested
  if (tags !== undefined) args.tags = tags
  if (del !== undefined) args.delete = del

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'trace', arguments: args } })
  })

  const data = await res.text()
  return NextResponse.json({ ok: true, result: data })
}
