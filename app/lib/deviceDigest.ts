import 'server-only'
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'

export async function deviceDigest(): Promise<string> {
  try {
    const { baseUrl, token } = getHavenGatewayConnection()
    const response = await fetch(joinHavenUrl(baseUrl, '/api/device-events/digest'), {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) return ''
    const data = await response.json()
    return typeof data.digest === 'string' ? data.digest.trim().replace(/[\r\n]+/g, ' ') : ''
  } catch { return '' }
}
