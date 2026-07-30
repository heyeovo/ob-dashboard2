// CC 内置联网工具配置。默认值存 Haven；每个窗口拿一份副本，首句后锁定。

export type CcWebDomainMode = 'all' | 'allow' | 'block'

export type CcWebSettings = {
  searchEnabled: boolean
  fetchEnabled: boolean
  maxSearchesPerTurn: number
  maxFetchesPerTurn: number
  /** WebFetch 提示里的目标上限；SDK 没有硬 max_tokens，所以这是软限制。 */
  fetchTargetTokens: number
  /** 搜索结果保存 / 展示时最多保留多少条来源。 */
  maxDisplayedSources: number
  domainMode: CcWebDomainMode
  domains: string[]
}

export const DEFAULT_WEB_SETTINGS: CcWebSettings = {
  searchEnabled: true,
  fetchEnabled: true,
  maxSearchesPerTurn: 3,
  maxFetchesPerTurn: 3,
  fetchTargetTokens: 4000,
  maxDisplayedSources: 5,
  domainMode: 'all',
  domains: [],
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function normalizeDomain(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw || /[^\x00-\x7F]/.test(raw)) return ''
  const withoutScheme = raw.replace(/^https?:\/\//, '')
  return withoutScheme.split('/')[0].replace(/^\.+|\.+$/g, '')
}

export function normalizeWebSettings(
  input: Record<string, unknown> | null | undefined,
): CcWebSettings {
  const raw = input || {}
  const mode = String(raw.domainMode ?? raw.domain_mode ?? 'all')
  const rawDomains = Array.isArray(raw.domains) ? raw.domains : []
  return {
    searchEnabled: raw.searchEnabled ?? raw.search_enabled ?? true ? true : false,
    fetchEnabled: raw.fetchEnabled ?? raw.fetch_enabled ?? true ? true : false,
    maxSearchesPerTurn: boundedInt(
      raw.maxSearchesPerTurn ?? raw.max_searches_per_turn,
      DEFAULT_WEB_SETTINGS.maxSearchesPerTurn,
      1,
      10,
    ),
    maxFetchesPerTurn: boundedInt(
      raw.maxFetchesPerTurn ?? raw.max_fetches_per_turn,
      DEFAULT_WEB_SETTINGS.maxFetchesPerTurn,
      1,
      10,
    ),
    fetchTargetTokens: boundedInt(
      raw.fetchTargetTokens ?? raw.fetch_target_tokens,
      DEFAULT_WEB_SETTINGS.fetchTargetTokens,
      500,
      16000,
    ),
    maxDisplayedSources: boundedInt(
      raw.maxDisplayedSources ?? raw.max_displayed_sources,
      DEFAULT_WEB_SETTINGS.maxDisplayedSources,
      1,
      20,
    ),
    domainMode: mode === 'allow' ? 'allow' : mode === 'block' ? 'block' : 'all',
    domains: [...new Set(rawDomains.map(normalizeDomain).filter(Boolean))].slice(0, 50),
  }
}

export function webSettingsToHaven(settings: CcWebSettings): Record<string, unknown> {
  const safe = normalizeWebSettings(settings as unknown as Record<string, unknown>)
  return {
    search_enabled: safe.searchEnabled,
    fetch_enabled: safe.fetchEnabled,
    max_searches_per_turn: safe.maxSearchesPerTurn,
    max_fetches_per_turn: safe.maxFetchesPerTurn,
    fetch_target_tokens: safe.fetchTargetTokens,
    max_displayed_sources: safe.maxDisplayedSources,
    domain_mode: safe.domainMode,
    domains: safe.domains,
  }
}
