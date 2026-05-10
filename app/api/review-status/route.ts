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

async function readStateBucket() {
  const bucketId = process.env.REVIEW_BUCKET_ID!
  const res = await fetch(`${process.env.OMBRE_BASE_URL}/api/bucket/${bucketId}`)
  const bucket = await res.json()
  const raw = bucket?.content?.raw ?? bucket?.content ?? '{}'
  const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}')
  // 兼容旧格式（直接是 {id: status} 的扁平结构）
  if (parsed.status_map || parsed.categories) return parsed
  return { status_map: parsed, category_map: {}, categories: [] }
}

export async function GET() {
  try {
    const bucketId = process.env.REVIEW_BUCKET_ID!
    const state = await readStateBucket()
    return NextResponse.json({
      bucketId,
      statusMap: state.status_map ?? {},
      categoryMap: state.category_map ?? {},
      categories: state.categories ?? [],
    })
  } catch {
    return NextResponse.json({ bucketId: process.env.REVIEW_BUCKET_ID, statusMap: {}, categoryMap: {}, categories: [] })
  }
}

export async function POST(req: Request) {
  try {
    const { statesBucketId, targetId, status, category, newCategory } = await req.json()
    const state = await readStateBucket()
    const status_map = state.status_map ?? {}
    const category_map = state.category_map ?? {}
    const categories: string[] = state.categories ?? []

    if (status !== undefined) {
      if (status === null) delete status_map[targetId]
      else status_map[targetId] = status
    }
    if (category !== undefined) {
      if (category === null) delete category_map[targetId]
      else category_map[targetId] = category
    }
    if (newCategory && !categories.includes(newCategory)) {
      categories.push(newCategory)
    }

    await callOB('trace', {
      bucket_id: statesBucketId,
      content: JSON.stringify({ status_map, category_map, categories })
    })
    return NextResponse.json({ ok: true, categories })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}