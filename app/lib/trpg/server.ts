import { getHavenBaseUrl, getHavenGatewayToken, joinHavenUrl } from '../havenConfig'
import type { Table } from './table'

export type TrpgSettings = { yanzhi_model: string; persona_id: string }
export type YanzhiRuntime = { session_id: string | null; session_tokens: number; last_seen_seq: number; last_error: string | null; running_since: string | null }
export type YanzhiView = Table & { latest_recap: { public?: string } }

/** Service-only endpoints: never send credentials or unfiltered game data to the browser. */
export async function trpgServerRequest<T>(gameId: string, endpoint: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(joinHavenUrl(getHavenBaseUrl(), `/trpg/api/games/${encodeURIComponent(gameId)}/${endpoint}`), {
    method, headers: { Authorization: `Bearer ${getHavenGatewayToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('跑团状态读写失败，请稍后重试')
  return await response.json() as T
}
