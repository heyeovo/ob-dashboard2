import type { CcDeliveryState, CcEngine, CcTurnContext, CcTurnUsage } from './types'

export function effectiveEngine(
  isRemote: boolean | null,
  localPreference: CcEngine,
): CcEngine {
  return isRemote === true ? 'selfhost' : localPreference
}

export function requiresImportedSessionHandoff(source: string, engine: CcEngine): boolean {
  const normalized = source.trim().toLowerCase()
  if (!normalized || normalized === 'cc' || normalized === 'selfhost') return false
  return engine === 'cc'
}

export function providerSelectionLocked(engine: CcEngine, turnActive: boolean): boolean {
  return engine === 'cc' && turnActive
}

export function normalizeProviderUsage(value: unknown): CcTurnUsage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const number = (key: string) => {
    const parsed = Number(raw[key] ?? 0)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }
  const snakeCase = 'input_tokens' in raw || 'output_tokens' in raw
  return {
    inputTokens: snakeCase ? number('input_tokens') : number('inputTokens'),
    outputTokens: snakeCase ? number('output_tokens') : number('outputTokens'),
    cacheReadTokens: snakeCase ? number('cache_read_input_tokens') : number('cacheReadTokens'),
    cacheWriteTokens: snakeCase ? number('cache_creation_input_tokens') : number('cacheWriteTokens'),
    cacheWrite1hTokens: number('cacheWrite1hTokens'),
    cacheWrite5mTokens: number('cacheWrite5mTokens'),
    durationMs: number('durationMs'),
    tokensPerSec: number('tokensPerSec'),
    costUsd: number('costUsd'),
  }
}

export function normalizeTurnContext(value: unknown): CcTurnContext | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const number = (key: string) => {
    const parsed = Number(raw[key] ?? 0)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }
  return {
    estimator: typeof raw.estimator === 'string' ? raw.estimator : undefined,
    modelContextLimit: number('model_context_limit'),
    replyReserveTokens: number('reply_reserve_tokens'),
    inputTokensEstimated: number('input_tokens_estimated'),
    historyTokensEstimated: number('history_tokens_estimated'),
    includedHistoryRounds: number('included_history_rounds'),
    omittedHistoryRounds: number('omitted_history_rounds'),
  }
}

export function deliveryFromError(payload: Record<string, unknown>): {
  state: CcDeliveryState
  note: string
  keepGenerated: boolean
} {
  const code = String(payload.code || '')
  const message = String(payload.message || '出错了')
  const generated = payload.generated_not_saved === true
  if (payload.persistence_unknown === true || code === 'persistence_unknown') {
    return {
      state: 'persistence_unknown',
      note: '保存结果未知，请刷新或点“核对保存状态”确认。',
      keepGenerated: true,
    }
  }
  if (code === 'conversation_conflict' || Number(payload.http_status) === 409) {
    return {
      state: 'conflict',
      note: '另一端产生了新消息，请刷新后重试。本轮回复未保存。',
      keepGenerated: generated,
    }
  }
  if (generated) {
    return { state: 'not_saved', note: message || '回复已生成，但未保存。', keepGenerated: true }
  }
  return { state: 'not_saved', note: message, keepGenerated: false }
}

export function newTurnRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
