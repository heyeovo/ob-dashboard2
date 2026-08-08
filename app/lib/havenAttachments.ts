import { describeFetchError } from './havenReadFetch'

const HAVEN_BASE = (
  process.env.HAVEN_GATEWAY_URL ||
  process.env.OMBRE_BASE_URL ||
  process.env.NEXT_PUBLIC_OMBRE_BASE_URL ||
  'https://foryan.zeabur.app'
).replace(/\/+$/, '')

const GATEWAY_TOKEN = process.env.OMBRE_GATEWAY_TOKEN || ''

export type HavenAttachment = {
  id: string
  session_id: string
  turn_id: number | null
  round_id: number | null
  filename: string
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
  byte_size: number
  sha256: string
  created_at: string
  cleared: boolean
  cleared_at?: string
}

export type ResolvedAttachment = HavenAttachment & { base64: string }

function headers(sessionId = ''): Record<string, string> {
  const value: Record<string, string> = { Authorization: `Bearer ${GATEWAY_TOKEN}` }
  if (sessionId) value['X-Ombre-Session-Id'] = sessionId
  return value
}

async function errorText(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return String(parsed.message || parsed.error || `HTTP ${response.status}`)
  } catch {
    return raw.slice(0, 300) || `HTTP ${response.status}`
  }
}

export async function uploadAttachment(input: {
  sessionId: string
  filename: string
  bytes: ArrayBuffer
  mimeType: string
}): Promise<{ ok: boolean; attachment: HavenAttachment | null; error: string; status: number }> {
  if (!GATEWAY_TOKEN) return { ok: false, attachment: null, error: 'OMBRE_GATEWAY_TOKEN 未配置', status: 500 }
  const params = new URLSearchParams({ session_id: input.sessionId, filename: input.filename })
  try {
    const response = await fetch(`${HAVEN_BASE}/gateway/api/conversation/attachment?${params}`, {
      method: 'POST',
      headers: { ...headers(input.sessionId), 'Content-Type': input.mimeType },
      body: input.bytes,
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, attachment: null, error: await errorText(response), status: response.status }
    const payload = await response.json() as Record<string, unknown>
    return { ok: true, attachment: payload.attachment as HavenAttachment, error: '', status: response.status }
  } catch (error) {
    return { ok: false, attachment: null, error: describeFetchError(error), status: 502 }
  }
}

export async function fetchAttachmentResponse(attachmentId: string, sessionId = ''): Promise<Response> {
  if (!GATEWAY_TOKEN) return Response.json({ error: 'OMBRE_GATEWAY_TOKEN 未配置' }, { status: 500 })
  const params = new URLSearchParams({ attachment_id: attachmentId })
  if (sessionId) params.set('session_id', sessionId)
  try {
    return await fetch(`${HAVEN_BASE}/gateway/api/conversation/attachment?${params}`, {
      headers: headers(sessionId),
      cache: 'no-store',
    })
  } catch (error) {
    return Response.json({ error: describeFetchError(error) }, { status: 502 })
  }
}

export async function resolveAttachments(
  attachmentIds: string[],
  sessionId: string,
  metadata: HavenAttachment[] = [],
): Promise<ResolvedAttachment[]> {
  const byId = new Map(metadata.map(item => [item.id, item]))
  const resolved: ResolvedAttachment[] = []
  for (const id of attachmentIds) {
    const response = await fetchAttachmentResponse(id, sessionId)
    if (!response.ok) throw new Error(await errorText(response))
    const mimeType = response.headers.get('content-type')?.split(';')[0] || ''
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
      throw new Error('Haven 返回了不支持的图片格式')
    }
    const bytes = await response.arrayBuffer()
    const known = byId.get(id)
    resolved.push({
      id,
      session_id: sessionId,
      turn_id: known?.turn_id ?? null,
      round_id: known?.round_id ?? null,
      filename: known?.filename || 'image',
      mime_type: mimeType,
      byte_size: bytes.byteLength,
      sha256: known?.sha256 || '',
      created_at: known?.created_at || '',
      cleared: false,
      base64: Buffer.from(bytes).toString('base64'),
    })
  }
  return resolved
}

export async function clearAttachment(input: {
  attachmentId?: string
  sessionId: string
  all?: boolean
}): Promise<{ ok: boolean; error: string; status: number }> {
  if (!GATEWAY_TOKEN) return { ok: false, error: 'OMBRE_GATEWAY_TOKEN 未配置', status: 500 }
  try {
    const response = await fetch(`${HAVEN_BASE}/gateway/api/conversation/attachment`, {
      method: 'DELETE',
      headers: { ...headers(input.sessionId), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: input.sessionId,
        attachment_id: input.attachmentId,
        all: input.all === true,
      }),
      cache: 'no-store',
    })
    return response.ok
      ? { ok: true, error: '', status: response.status }
      : { ok: false, error: await errorText(response), status: response.status }
  } catch (error) {
    return { ok: false, error: describeFetchError(error), status: 502 }
  }
}
