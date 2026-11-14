import type { HandoffSnapshot } from '../cc/handoffSnapshot'
import type { CcSseDelta, CcSseStart, CcSseRecall } from '../cc/sseEvents'

export const GPT_ENGINE = 'gpt_subscription' as const
export type GptConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reauth_required'
export type GptConnectionError = {
  code: string; message: string; retryable: boolean
  action: 'reconnect' | 'usage_settings' | 'enable_sharing' | 'retry' | 'inspect'
  status?: number
}
export type GptConnectionFailure = { ok: false; error: GptConnectionError }
export type GptConnectionResponse = GptConnectionFailure | {
  ok: true; configured: boolean; status: GptConnectionStatus; sharing: boolean
  login_method: 'local_ssh_import'; limits: null; usage_url: string
  connection_id?: string; label?: string; account?: string; error?: GptConnectionError
}
export type GptConnectionsResponse = GptConnectionFailure | {
  ok: true; connections: Array<{ connection_id: string; label: string; status: GptConnectionStatus; sharing: boolean }>
}
export type GptModelsResponse = GptConnectionFailure | { ok: true; models: Array<{ slug: string; displayName: string }> }
export type GptConnectionRequest = { action: 'select'; connection_id: string } | { action: 'disconnect' }
export type GptUsage = {
  input_tokens: number | null; output_tokens: number | null; total_tokens: number | null
  cached_tokens: number | null; reasoning_tokens: number | null
}
export type GptRequest = {
  session_id: string; request_id: string; persona_id: string; text: string
  expected_last_round_id: number; model?: string; mode?: 'chat'; recall?: boolean
  include_daily_review?: boolean; handoff_snapshot?: HandoffSnapshot
}
export type GptError = {
  code: string; message: string; stage: 'preflight' | 'generation' | 'persistence'
  retryable: boolean; request_id: string; http_status?: number | null
  official_request_id?: string
  generated_not_saved?: boolean; persistence_unknown?: boolean; action?: string
  expected_last_round_id?: number; actual_last_round_id?: number
  partial_saved?: boolean
}
export type GptDone = {
  request_id: string; turn_id: number; round_id: number
  user_message_id: string; assistant_message_id: string; idempotent_replay: boolean
  engine: typeof GPT_ENGINE; model: string; usage: GptUsage | null
  interrupted: boolean; outcome: 'completed' | 'cancelled' | 'failed'; elapsed_ms: number
}
// CC event names and text/recall shapes; GPT terminal metadata stays explicit.
export type GptEventMap = {
  start: CcSseStart
  init: { engine: typeof GPT_ENGINE; model: string; session_id: string; request_id: string }
  delta: CcSseDelta
  recall: CcSseRecall
  context: Record<string, unknown>
  usage: { usage: GptUsage | null }
  error: GptError
  done: GptDone
}

export function parseGptRequest(value: unknown): GptRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是对象')
  const b = value as Record<string, unknown>
  const allowed = new Set(['session_id', 'request_id', 'persona_id', 'text', 'expected_last_round_id',
    'model', 'mode', 'recall', 'include_daily_review', 'handoff_snapshot', 'attachment_ids'])
  if (Object.keys(b).some(key => !allowed.has(key))) throw new Error('GPT 首版仅支持文字聊天')
  for (const key of ['session_id', 'persona_id']) {
    if (typeof b[key] !== 'string' || !b[key].trim() || b[key].length > 200) throw new Error(`${key} 无效`)
  }
  if (typeof b.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(b.request_id)) throw new Error('request_id 无效')
  if (typeof b.text !== 'string' || !b.text.trim() || new TextEncoder().encode(b.text).length > 500_000) throw new Error('文字为空或过长')
  if (!Number.isInteger(b.expected_last_round_id) || Number(b.expected_last_round_id) < 0) throw new Error('expected_last_round_id 无效')
  if (b.mode !== undefined && b.mode !== 'chat') throw new Error('GPT 首版不支持工作模式')
  if (b.attachment_ids !== undefined && (!Array.isArray(b.attachment_ids) || b.attachment_ids.length)) throw new Error('GPT 首版不支持附件，请先移除附件')
  if (b.model !== undefined && (typeof b.model !== 'string' || !b.model.trim() || b.model.length > 200)) throw new Error('model 无效')
  for (const key of ['recall', 'include_daily_review']) {
    if (b[key] !== undefined && typeof b[key] !== 'boolean') throw new Error(`${key} 必须为布尔值`)
  }
  if (b.handoff_snapshot !== undefined && (!b.handoff_snapshot || typeof b.handoff_snapshot !== 'object' || Array.isArray(b.handoff_snapshot))) throw new Error('handoff_snapshot 无效')
  return { ...b, session_id: String(b.session_id).trim(), persona_id: String(b.persona_id).trim(),
    model: typeof b.model === 'string' ? b.model.trim() : undefined } as GptRequest
}

export function gptError(requestId: string, code: string, message: string, stage: GptError['stage'] = 'preflight', retryable = false): GptError {
  return { code, message, stage, retryable, request_id: requestId }
}
