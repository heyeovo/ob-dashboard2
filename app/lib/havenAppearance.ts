import 'server-only'

import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from './appearance'
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'

const PATH = '/gateway/api/cc/appearance'

export function appearanceConnection(path = PATH) {
  const { baseUrl, token } = getHavenGatewayConnection()
  return { url: joinHavenUrl(baseUrl, path), token }
}

export async function loadAppearance(): Promise<{ appearance: Appearance; fromHaven: boolean }> {
  try {
    const { url, token } = appearanceConnection()
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(1800),
    })
    if (!response.ok) throw new Error(`Haven appearance HTTP ${response.status}`)
    const payload = await response.json() as { appearance?: unknown }
    return { appearance: normalizeAppearance(payload.appearance), fromHaven: true }
  } catch {
    return { appearance: DEFAULT_APPEARANCE, fromHaven: false }
  }
}
