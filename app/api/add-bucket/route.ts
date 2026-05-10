import { NextResponse } from 'next/server'

const OB_MCP = `${process.env.OMBRE_BASE_URL}/mcp`

async function callOB(tool: string, args: Record<string, unknown>) {
  const initRes = await fetch(OB_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ob-dashboard', version: '1.0' } } })
  })
  const sessionId = initRes.headers.get('mcp-session-id')
  const res = await fetch(OB_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } })
  })
  const rawText = await res.text()
  const dataLine = rawText.split('\n').find(line => line.startsWith('data: '))
  const data = JSON.parse(dataLine?.slice(6) ?? '{}')
  return data?.result?.content?.[0]?.text ?? ''
}

export async function POST(req: Request) {
  try {
    const { content, tags, importance } = await req.json()
    const result = await callOB('hold', {
      content,
      tags,
      importance: Number(importance),
    })
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
