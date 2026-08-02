// 上游模型配置（5.2）。整份配置存 Haven 的 cc_upstream_config，走 /api/cc-upstream。
//
// 为什么要它：以前只有 .env.local 里那一条中转站 + 一个模型名，界面上没得选。
// 「本窗口设置」要能列出所有中转站 + 每个站下的模型名，就得有个地方存这份清单。
//
// ⚠️ 存 Haven 不存浏览器 —— 跟协作者同一个理由（手机和电脑读同一份）。
// ⚠️ 中转站的 token 明文存在 Haven 库里，跟协作者配置一样属于「只有本人用」的私有库。

/** 凭据来源。订阅 = 本机 claude 登录态；api = 打中转站。 */
export type CcProviderKind = 'subscription' | 'api'

/** reasoning effort。SDK 的 EffortLevel 同名取值。 */
export type CcEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORT_OPTIONS: { id: CcEffort; label: string }[] = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '很高' },
  { id: 'max', label: '最高' },
]

/** 一个中转站。models 是这个站上能用的模型名（人工填，中转站一般不给可靠的列表接口）。 */
export type CcProvider = {
  id: string
  /** 显示名，比如「特特价次 kiro」 */
  label: string
  /** ANTHROPIC_BASE_URL */
  baseUrl: string
  /** ANTHROPIC_AUTH_TOKEN。⚠️ 明文存 Haven */
  token: string
  /** 这个站上的模型名清单，直接作为 ANTHROPIC_MODEL / setModel 的值 */
  models: string[]
}

export type CcUpstreamConfig = {
  providers: CcProvider[]
  /** 订阅侧能选的模型名（本机 claude 支持哪些就填哪些，留空用它自己的默认） */
  subscriptionModels: string[]
  /** 新对话默认用哪套 */
  defaultKind: CcProviderKind
  defaultProviderId: string
  defaultModel: string
  defaultEffort: CcEffort
  /** 默认开不开 thinking。关掉 = maxThinkingTokens 传 null */
  defaultThinking: boolean
  updatedAt?: string
}

export const EMPTY_UPSTREAM: CcUpstreamConfig = {
  providers: [],
  subscriptionModels: [],
  defaultKind: 'api',
  defaultProviderId: '',
  defaultModel: '',
  defaultEffort: 'high',
  defaultThinking: true,
}

function strList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => String(item ?? '').trim()).filter(Boolean)
}

function isEffort(raw: unknown): raw is CcEffort {
  return EFFORT_OPTIONS.some(o => o.id === raw)
}

/** Haven 存的 snake_case JSON → 界面用的驼峰对象。字段缺了就用默认值。 */
export function upstreamFromHaven(raw: Record<string, unknown> | null | undefined): CcUpstreamConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_UPSTREAM }
  const rawProviders = Array.isArray(raw.providers) ? (raw.providers as Record<string, unknown>[]) : []
  const providers: CcProvider[] = rawProviders
    .map((p, i) => ({
      id: String(p.id || '') || `pv-${i}`,
      label: String(p.label || '') || `中转站 ${i + 1}`,
      baseUrl: String(p.base_url || p.baseUrl || '').trim(),
      token: String(p.token || '').trim(),
      models: strList(p.models),
    }))
    .filter(p => p.baseUrl)
  return {
    providers,
    subscriptionModels: strList(raw.subscription_models ?? raw.subscriptionModels),
    defaultKind: raw.default_kind === 'subscription' ? 'subscription' : 'api',
    defaultProviderId: String(raw.default_provider_id ?? raw.defaultProviderId ?? ''),
    defaultModel: String(raw.default_model ?? raw.defaultModel ?? ''),
    defaultEffort: isEffort(raw.default_effort) ? raw.default_effort : 'high',
    defaultThinking: raw.default_thinking !== false,
    updatedAt: String(raw.updated_at ?? '') || undefined,
  }
}

/** 界面驼峰 → 提交给 /api/cc-upstream 的 snake_case */
export function upstreamToPayload(config: CcUpstreamConfig): Record<string, unknown> {
  return {
    providers: config.providers.map(p => ({
      id: p.id,
      label: p.label,
      base_url: p.baseUrl,
      token: p.token,
      models: p.models,
    })),
    subscription_models: config.subscriptionModels,
    default_kind: config.defaultKind,
    default_provider_id: config.defaultProviderId,
    default_model: config.defaultModel,
    default_effort: config.defaultEffort,
    default_thinking: config.defaultThinking,
  }
}

/** 新建中转站时的初值 */
export function draftProvider(): CcProvider {
  const rand = Math.random().toString(36).slice(2, 6)
  return {
    id: `pv-${Date.now().toString(36)}-${rand}`,
    label: '新中转站',
    baseUrl: '',
    token: '',
    models: [],
  }
}

/**
 * 一个窗口当前用哪套上游。发给 /api/cc-chat 的就是这个形状。
 *
 * ⚠️ kind / providerId 只在**新建对话**时生效（子进程的环境变量是启动时定死的）。
 * model / effort / thinking 可以中途换（SDK 的 setModel / setMaxThinkingTokens）。
 */
export type CcUpstreamPick = {
  kind: CcProviderKind
  providerId: string
  model: string
  effort: CcEffort
  thinking: boolean
}

/** 从整份配置推出「新对话该用哪套」。没配中转站时退回订阅那边不合适（可能没会员），
 *  所以保持 defaultKind 原样，让引擎层去兜底（api 时读 .env.local）。 */
export function pickFromConfig(config: CcUpstreamConfig): CcUpstreamPick {
  const provider =
    config.providers.find(p => p.id === config.defaultProviderId) || config.providers[0] || null
  const model =
    config.defaultModel ||
    (config.defaultKind === 'subscription'
      ? config.subscriptionModels[0] || ''
      : provider?.models[0] || '')
  return {
    kind: config.defaultKind,
    providerId: config.defaultKind === 'api' ? provider?.id || '' : '',
    model,
    effort: config.defaultEffort,
    thinking: config.defaultThinking,
  }
}

/** 这个 pick 下能选哪些模型名。 */
export function modelsFor(config: CcUpstreamConfig, kind: CcProviderKind, providerId: string): string[] {
  if (kind === 'subscription') return config.subscriptionModels
  const provider = config.providers.find(p => p.id === providerId)
  return provider?.models || []
}

/**
 * Claude Code 为 Opus 4.6 使用的 `opus[1m]` 是 SDK 内部别名，不是上游模型名。
 * 界面和本窗口配置继续显示 Haven 中配置的原始模型；候选列表为空时保留别名，
 * 等上游配置加载后再按候选模型还原。
 */
export function providerModelForSdkModel(model: string, candidates: string[] = []): string {
  const value = model.trim()
  if (!value || !/\[1m\]$/i.test(value)) return value

  const base = value.replace(/\[1m\]$/i, '')
  if (candidates.includes(base)) return base

  // SDK 可能只回传 `opus[1m]`，此时从当前 Provider 的 Opus 4.6 候选中找回原名。
  if (/^opus$/i.test(base)) {
    const opus46 = candidates.find(candidate =>
      /(?:^|[-_.])opus[-_.]?4[-_.]?6(?:$|[-_.])/i.test(candidate),
    )
    if (opus46) return opus46
  }

  return candidates.length > 0 ? base : value
}

/** 仅用于界面文字；没有候选列表时也不把 `[1m]` 露给用户。 */
export function modelLabel(model: string, candidates: string[] = []): string {
  const value = model.trim()
  if (!value) return ''
  const normalized = providerModelForSdkModel(value, candidates)
  if (normalized !== value) return normalized
  if (/^opus\[1m\]$/i.test(value)) return 'claude-opus-4-6'
  return value.replace(/\[1m\]$/i, '')
}
