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
  const text = data?.result?.content?.[0]?.text ?? ''
  try { return JSON.parse(text) } catch { return text }
}

export async function GET() {
  try {
    const bucketId = process.env.REVIEW_BUCKET_ID!
    const res = await fetch(`${process.env.OMBRE_BASE_URL}/api/bucket/${bucketId}`)
    const bucket = await res.json()
    const raw = bucket?.content?.raw ?? bucket?.content ?? '{}'
    const statusMap = JSON.parse(typeof raw === 'string' ? raw : '{}')
    return NextResponse.json({ bucketId, statusMap })
  } catch {
    return NextResponse.json({ bucketId: process.env.REVIEW_BUCKET_ID, statusMap: {} })
  }
}

export async function POST(req: Request) {
  try {
    const { statesBucketId, targetId, status } = await req.json()
    const res = await fetch(`${process.env.OMBRE_BASE_URL}/api/bucket/${statesBucketId}`)
    const bucket = await res.json()
    const raw = bucket?.content?.raw ?? bucket?.content ?? '{}'
    const current: Record<string, string> = JSON.parse(typeof raw === 'string' ? raw : '{}')
    if (status === null) delete current[targetId]
    else current[targetId] = status
    await callOB('trace', { bucket_id: statesBucketId, content: JSON.stringify(current) })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
