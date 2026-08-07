import type { HavenTurn } from '@/app/lib/havenTurns'

export const DEFAULT_HISTORY_TOKEN_BUDGET = 150_000
export const DEFAULT_REPLY_RESERVE_TOKENS = 32_000
export const DEFAULT_MAX_HISTORY_ROUNDS = 0
export const TOKEN_ESTIMATOR = 'utf8-bytes-div-3-v1'
export const ESTIMATE_SAFETY_RATIO = 1.05

export type SelfhostSettings = {
  providerId: string
  model: string
  historyTokenBudget: number
  maxHistoryRounds: number
  replyReserveTokens: number
}

export type ContextStats = {
  estimator: string
  estimate_safety_ratio: number
  model_context_limit: number
  reply_reserve_tokens: number
  fixed_tokens_estimated: number
  history_budget_tokens: number
  history_available_tokens: number
  history_tokens_estimated: number
  input_tokens_estimated: number
  included_history_rounds: number
  omitted_history_rounds: number
  max_history_rounds: number
  truncated: boolean
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

function stringValue(value: unknown, fallback: string): string {
  const text = String(value || '').trim()
  return text || fallback
}

/** 全局 → Persona → 单窗口；只解析 10.1 已允许持久化的字段。 */
export function resolveSelfhostSettings(input: {
  globalProviderId?: string
  globalModel?: string
  personaDefaults?: Record<string, unknown>
  sessionOverrides?: Record<string, unknown>
}): SelfhostSettings {
  const persona = input.personaDefaults || {}
  const session = input.sessionOverrides || {}
  return {
    providerId: stringValue(session.provider_id, stringValue(persona.provider_id, input.globalProviderId || '')),
    model: stringValue(session.model, stringValue(persona.model, input.globalModel || '')),
    historyTokenBudget: nonNegativeInteger(
      session.history_token_budget,
      nonNegativeInteger(persona.history_token_budget, DEFAULT_HISTORY_TOKEN_BUDGET),
    ),
    maxHistoryRounds: nonNegativeInteger(
      session.max_history_rounds,
      nonNegativeInteger(persona.max_history_rounds, DEFAULT_MAX_HISTORY_ROUNDS),
    ),
    replyReserveTokens: nonNegativeInteger(
      session.reply_reserve_tokens,
      nonNegativeInteger(persona.reply_reserve_tokens, DEFAULT_REPLY_RESERVE_TOKENS),
    ),
  }
}

/** 与现有 cc 顶部口径一致：明确的 Opus 4.6 是名义 1M；其余已知 Claude 家族保守按 200K。 */
export function nominalContextLimit(model: string): number {
  const value = (model || '').toLowerCase()
  if (/(?:^|[-_.])opus[-_.]?4[-_.]?6(?:$|[-_.])/.test(value) || value.includes('opus[1m]')) return 1_000_000
  if (value.includes('opus') || value.includes('sonnet') || value.includes('haiku') || value.includes('fable') || value.includes('mythos')) {
    return 200_000
  }
  // 未知 Anthropic-compatible 模型不能假装知道真实上限；发送侧采用保守兜底。
  return 200_000
}

/** 不冒充 Provider tokenizer；对中文和英文都留出余量，再统一加 5% 安全边际。 */
export function estimateTokens(text: string): number {
  return text ? Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 3)) : 0
}

export function estimateTurnTokens(turn: Pick<HavenTurn, 'user_text' | 'assistant_text'>): number {
  return estimateTokens(turn.user_text) + estimateTokens(turn.assistant_text) + 12
}

export function selectHistory(input: {
  turns: HavenTurn[]
  system: string
  currentUserText: string
  toolDefinitionsText?: string
  model: string
  historyTokenBudget: number
  maxHistoryRounds: number
  replyReserveTokens: number
}): { selected: HavenTurn[]; stats: ContextStats; error: string } {
  const limit = nominalContextLimit(input.model)
  const fixedRaw =
    estimateTokens(input.system) +
    estimateTokens(input.currentUserText) +
    estimateTokens(input.toolDefinitionsText || '') +
    16
  const fixedWithSafety = Math.ceil(fixedRaw * ESTIMATE_SAFETY_RATIO)
  const reserve = Math.max(0, input.replyReserveTokens)
  if (fixedWithSafety + reserve > limit) {
    return {
      selected: [],
      stats: {
        estimator: TOKEN_ESTIMATOR,
        estimate_safety_ratio: ESTIMATE_SAFETY_RATIO,
        model_context_limit: limit,
        reply_reserve_tokens: reserve,
        fixed_tokens_estimated: fixedWithSafety,
        history_budget_tokens: input.historyTokenBudget,
        history_available_tokens: 0,
        history_tokens_estimated: 0,
        input_tokens_estimated: fixedWithSafety,
        included_history_rounds: 0,
        omitted_history_rounds: input.turns.length,
        max_history_rounds: input.maxHistoryRounds,
        truncated: input.turns.length > 0,
      },
      error: 'system、召回与当前消息已经超过名义上下文上限（含回复预留），未向上游发送',
    }
  }

  const byModel = Math.max(0, limit - reserve - fixedWithSafety)
  const historyAvailable = input.historyTokenBudget > 0
    ? Math.min(byModel, input.historyTokenBudget)
    : byModel
  const pickedNewestFirst: HavenTurn[] = []
  let historyRaw = 0
  for (let index = input.turns.length - 1; index >= 0; index -= 1) {
    if (input.maxHistoryRounds > 0 && pickedNewestFirst.length >= input.maxHistoryRounds) break
    const turn = input.turns[index]
    const turnTokens = estimateTurnTokens(turn)
    // 只选连续的完整轮次：下一条旧轮放不下就停止，不跨洞挑更老的小轮次。
    if (Math.ceil((historyRaw + turnTokens) * ESTIMATE_SAFETY_RATIO) > historyAvailable) break
    pickedNewestFirst.push(turn)
    historyRaw += turnTokens
  }
  const selected = pickedNewestFirst.reverse()
  const historyWithSafety = Math.ceil(historyRaw * ESTIMATE_SAFETY_RATIO)
  const included = selected.length
  return {
    selected,
    stats: {
      estimator: TOKEN_ESTIMATOR,
      estimate_safety_ratio: ESTIMATE_SAFETY_RATIO,
      model_context_limit: limit,
      reply_reserve_tokens: reserve,
      fixed_tokens_estimated: fixedWithSafety,
      history_budget_tokens: input.historyTokenBudget,
      history_available_tokens: historyAvailable,
      history_tokens_estimated: historyWithSafety,
      input_tokens_estimated: fixedWithSafety + historyWithSafety,
      included_history_rounds: included,
      omitted_history_rounds: Math.max(0, input.turns.length - included),
      max_history_rounds: input.maxHistoryRounds,
      truncated: included < input.turns.length,
    },
    error: '',
  }
}
