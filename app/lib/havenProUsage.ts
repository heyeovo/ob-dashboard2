import type { CcProUsageSnapshot } from './ccSession'
import { describeFetchError, fetchHavenWithReadRetry } from './havenReadFetch'
import { getHavenGatewayConnection, joinHavenUrl } from './havenConfig'

const PATH = '/gateway/api/cc/pro-usage-snapshot'

async function request(
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<{ ok: boolean; snapshot: CcProUsageSnapshot | null; error: string }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  try {
    const { baseUrl, token } = getHavenGatewayConnection()
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetchHavenWithReadRetry(joinHavenUrl(baseUrl, PATH), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
      cache: 'no-store',
    })
    const raw = await res.text()
    if (!res.ok) return { ok: false, snapshot: null, error: `HTTP ${res.status}: ${raw.slice(0, 300)}` }
    const payload = JSON.parse(raw) as Record<string, unknown>
    const value = payload.snapshot
    if (!value || typeof value !== 'object' || !String((value as Record<string, unknown>).updatedAt || '')) {
      return { ok: true, snapshot: null, error: '' }
    }
    return { ok: true, snapshot: value as CcProUsageSnapshot, error: '' }
  } catch (error) {
    const err = error as Error
    return {
      ok: false,
      snapshot: null,
      error: err.name === 'AbortError' ? 'Pro 额度快照请求超时' : describeFetchError(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function loadProUsageSnapshot() {
  return request('GET')
}

export function saveProUsageSnapshot(snapshot: CcProUsageSnapshot) {
  return request('POST', { snapshot })
}
