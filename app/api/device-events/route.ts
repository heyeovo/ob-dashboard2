import { createHash, timingSafeEqual } from 'node:crypto'
import { receiveDeviceEvents } from '../../lib/deviceEvents'

export async function POST(request: Request) {
  const token = process.env.DEVICE_EVENTS_TOKEN
  if (!token) return Response.json({ error: '手机记录尚未配置' }, { status: 503 })
  const supplied = request.headers.get('authorization') || ''
  const hash = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(hash(supplied), hash(`Bearer ${token}`))) {
    return Response.json({ error: '凭据无效' }, { status: 401 })
  }
  return receiveDeviceEvents(request)
}
