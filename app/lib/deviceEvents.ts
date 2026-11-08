import 'server-only'
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'

/** Read a bounded stream, including clients without Content-Length. */
export async function readDeviceBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('请求为空')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 16384) {
      await reader.cancel()
      throw new Error('请求过大')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function forwardDeviceEvents(payload: unknown): Promise<Response> {
  try {
    const { baseUrl, token } = getHavenGatewayConnection()
    const response = await fetch(joinHavenUrl(baseUrl, '/api/device-events'), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5000), cache: 'no-store',
    })
    if (!response.ok) return Response.json({ error: '事件写入失败' }, { status: response.status === 400 || response.status === 413 ? response.status : 502 })
    const { accepted, duplicates } = await response.json()
    return Response.json({ ok: true, accepted, duplicates })
  } catch { return Response.json({ error: '暂时无法记录' }, { status: 502 }) }
}

export async function receiveDeviceEvents(request: Request): Promise<Response> {
  try { return await forwardDeviceEvents(await readDeviceBody(request)) }
  catch (error) {
    const large = error instanceof Error && error.message === '请求过大'
    return Response.json({ error: large ? '请求过大' : '事件格式无效' }, { status: large ? 413 : 400 })
  }
}
