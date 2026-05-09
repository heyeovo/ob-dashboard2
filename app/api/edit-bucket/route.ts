import { NextRequest, NextResponse } from 'next/server'

const MCP_URL = 'https://forxiaoyan.zeabur.app/mcp'

async function getMcpSession() {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ob-dashboard', version: '1.0' }
      }
    })
  })
  return res.headers.get('mcp-session-id')
}

export async function POST(req: NextRequest) {
  const { id, content } = await req.json()
  if (!id || content === undefined) {
    return NextResponse.json({ error: 'missing id or content' }, { status: 400 })
  }

  const sessionId = await getMcpSession()
  if (!sessionId) {
    return NextResponse.json({ error: 'failed to get session' }, { status: 500 })
  }

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'trace',
        arguments: { bucket_id: id, content }
      }
    })
  })

  const data = await res.text()
  return NextResponse.json({ ok: true, result: data })
}

