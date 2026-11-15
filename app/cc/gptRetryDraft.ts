import type { GptRequest } from './types'

// A disposable, per-tab retry envelope. Never a source of engine/model preferences
// or saved history; Haven still decides request identity and durable completion.
const key = (sessionId: string) => `ob2-gpt-pending/${sessionId}`
export function readGptRetryDraft(storage: Pick<Storage, 'getItem'>, sessionId: string): GptRequest | undefined {
  try {
    const value = JSON.parse(storage.getItem(key(sessionId)) || 'null')
    if (!value || value.session_id !== sessionId || typeof value.request_id !== 'string'
      || !/^[A-Za-z0-9_-]{1,100}$/.test(value.request_id) || typeof value.text !== 'string'
      || typeof value.persona_id !== 'string' || !Number.isInteger(value.expected_last_round_id)) return
    return value as GptRequest
  } catch { return undefined }
}
export function saveGptRetryDraft(storage: Pick<Storage, 'setItem'>, request: GptRequest) {
  try { storage.setItem(key(request.session_id), JSON.stringify(request)) } catch { /* In-memory request remains available. */ }
}
export function clearGptRetryDraft(storage: Pick<Storage, 'getItem' | 'removeItem'>, sessionId: string, requestId: string) {
  try { if (readGptRetryDraft(storage, sessionId)?.request_id === requestId) storage.removeItem(key(sessionId)) } catch { /* Disposable cache. */ }
}
