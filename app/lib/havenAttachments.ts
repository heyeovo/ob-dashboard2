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
  kind?: 'image' | 'file'
  mime_type: string
  byte_size: number
  sha256: string
  text_chars?: number
  text_truncated?: boolean
  created_at: string
  cleared: boolean
  cleared_at?: string
}

export type ResolvedAttachment = HavenAttachment & { base64?: string; text_content?: string }

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
  kind?: 'image' | 'file'
  textContent?: string
  textTruncated?: boolean
}): Promise<{ ok: boolean; attachment: HavenAttachment | null; error: string; status: number }> {
  if (!GATEWAY_TOKEN) return { ok: false, attachment: null, error: 'OMBRE_GATEWAY_TOKEN 未配置', status: 500 }
  const params = new URLSearchParams({ session_id: input.sessionId, filename: input.filename })
  try {
    const isFile = input.kind === 'file'
    const body = isFile ? new FormData() : input.bytes
    if (body instanceof FormData) {
      body.set('session_id', input.sessionId)
      body.set('kind', 'file')
      body.set('text_content', input.textContent || '')
      body.set('text_truncated', input.textTruncated ? '1' : '0')
      body.set('file', new Blob([input.bytes], { type: input.mimeType }), input.filename)
    }
    const response = await fetch(`${HAVEN_BASE}/gateway/api/conversation/attachment?${params}`, {
      method: 'POST',
      headers: isFile ? headers(input.sessionId) : { ...headers(input.sessionId), 'Content-Type': input.mimeType },
      body,
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, attachment: null, error: await errorText(response), status: response.status }
    const payload = await response.json() as Record<string, unknown>
    return { ok: true, attachment: payload.attachment as HavenAttachment, error: '', status: response.status }
  } catch (error) {
    return { ok: false, attachment: null, error: describeFetchError(error), status: 502 }
  }
}

export async function fetchAttachmentResponse(attachmentId: string, sessionId = '', prompt = false): Promise<Response> {
  if (!GATEWAY_TOKEN) return Response.json({ error: 'OMBRE_GATEWAY_TOKEN 未配置' }, { status: 500 })
  const params = new URLSearchParams({ attachment_id: attachmentId })
  if (sessionId) params.set('session_id', sessionId)
  if (prompt) params.set('view', 'prompt')
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
    const response = await fetchAttachmentResponse(id, sessionId, true)
    if (!response.ok) throw new Error(await errorText(response))
    const known = byId.get(id)
    const kind = response.headers.get('x-ombre-attachment-kind') === 'file' ? 'file' : 'image'
    const mimeType = response.headers.get('x-ombre-original-mime')
      || response.headers.get('content-type')?.split(';')[0]
      || known?.mime_type
      || ''
    if (kind === 'image' && mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
      throw new Error('Haven 返回了不支持的图片格式')
    }
    const textContent = kind === 'file' ? await response.text() : ''
    const bytes = kind === 'image' ? await response.arrayBuffer() : new ArrayBuffer(0)
    resolved.push({
      id,
      session_id: sessionId,
      turn_id: known?.turn_id ?? null,
      round_id: known?.round_id ?? null,
      filename: known?.filename || (kind === 'image' ? 'image' : 'file'),
      kind,
      mime_type: mimeType,
      byte_size: known?.byte_size || bytes.byteLength,
      sha256: known?.sha256 || '',
      text_chars: known?.text_chars || textContent.length,
      text_truncated: known?.text_truncated
        ?? response.headers.get('x-ombre-text-truncated') === '1',
      created_at: known?.created_at || '',
      cleared: false,
      ...(kind === 'image' ? { base64: Buffer.from(bytes).toString('base64') } : { text_content: textContent }),
    })
  }
  return resolved
}

export async function clearAttachment(input: {
  attachmentId?: string
  sessionId: string
  all?: boolean
  kind?: 'image' | 'file'
}): Promise<{ ok: boolean; error: string; status: number; cleared: number }> {
  if (!GATEWAY_TOKEN) return { ok: false, error: 'OMBRE_GATEWAY_TOKEN 未配置', status: 500, cleared: 0 }
  try {
    const response = await fetch(`${HAVEN_BASE}/gateway/api/conversation/attachment`, {
      method: 'DELETE',
      headers: { ...headers(input.sessionId), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: input.sessionId,
        attachment_id: input.attachmentId,
        all: input.all === true,
        kind: input.kind,
      }),
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, error: await errorText(response), status: response.status, cleared: 0 }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    return { ok: true, error: '', status: response.status, cleared: Number(payload.cleared || 0) }
  } catch (error) {
    return { ok: false, error: describeFetchError(error), status: 502, cleared: 0 }
  }
}
