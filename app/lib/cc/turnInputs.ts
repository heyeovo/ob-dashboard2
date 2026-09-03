import { resolveDirs, resolveWriteDirs } from '@/app/lib/ccDirs'
import { buildPersonaAppend, getPersona } from '@/app/lib/havenPersonas'
import { loadUpstreamConfig, resolveProvider } from '@/app/lib/havenUpstream'
import { loadPermanentPermissionRules, permissionRuleStrings } from '@/app/lib/havenPermissions'
import { configuredMcpModelSurface, disabledMcpTools, loadMcpConfig, toSdkMcpServers } from '@/app/lib/ccMcp'
import { getConversationSession } from '@/app/lib/havenTurns'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import {
  ccLaneId,
  cacheRelevantFingerprint,
  sdkModelForProvider,
  setWriteDirs,
  type TurnConfig,
} from '@/app/lib/cc/ccOptions'
import type { CredMode } from '@/app/lib/ccEnv'
import { builtInMcpModelSurfaces } from '@/app/lib/cc/builtInMcp'
import { composeWindowPersonaAppend } from '@/app/lib/cc/windowPrompt'

/** Restore the single last-active native CC lane without any browser state. */
export async function loadBackgroundTurnInputs(sessionId: string) {
  const sessionResult = await getConversationSession(sessionId, { includeBucketExclusions: true })
  const session = sessionResult.session
  if (!sessionResult.ok || !session) throw new Error(sessionResult.error || 'Haven 返回空窗口')
  if (!session.frozen_persona_append_initialized) {
    throw new Error('窗口还没有成功启动过 CC，不能由后台冷启动')
  }

  const personaResult = await getPersona(session.persona_id)
  const persona = personaResult.persona
  if (!persona) throw new Error(`找不到窗口协作者：${session.persona_id}`)

  const cred: CredMode = session.cc_overrides.active_cred === 'subscription' ? 'subscription' : 'api'
  const route: Record<string, unknown> = cred === 'subscription'
    ? session.cc_overrides.subscription || {}
    : session.cc_overrides.api || {}
  let providerId = cred === 'api' ? String(route.provider_id || '').trim() : ''
  let providerLabel = ''
  let envOverrides: { baseUrl?: string; authToken?: string } = {}
  let model = String(route.model || '').trim()
  const effort = String(route.effort || '').trim()
  const thinking = route.thinking !== false

  if (cred === 'api') {
    const upstream = await loadUpstreamConfig()
    if (!upstream.ok) throw new Error(`读取 CC 上游配置失败：${upstream.error}`)
    const provider = resolveProvider(upstream.config, providerId)
    if (!provider) throw new Error(`找不到最后活跃的 CC provider：${providerId || 'default'}`)
    providerId = providerId || upstream.config.default_provider_id || ''
    providerLabel = provider.label
    envOverrides = { baseUrl: provider.baseUrl, authToken: provider.authToken }
    if (!model) model = String(upstream.config.default_model || '')
  }
  if (!model) model = process.env.ANTHROPIC_MODEL || ''

  const laneId = ccLaneId(cred, providerId)
  const lane = session.cc_lanes[laneId]
  const resumeHint = String(lane?.cc_session_id || '').trim()
  if (!lane || !resumeHint) throw new Error(`最后活跃 CC lane 没有可恢复的 resume id：${laneId}`)

  const [mcpConfig, permissions, readDirs, writeDirs] = await Promise.all([
    loadMcpConfig(),
    loadPermanentPermissionRules(),
    resolveDirs(persona.dirs),
    resolveWriteDirs(persona.write_dirs),
  ])
  setWriteDirs(sessionId, writeDirs)
  const webSettings = {
    ...DEFAULT_WEB_SETTINGS,
    searchEnabled: false,
    fetchEnabled: false,
  }
  const personaAppend = composeWindowPersonaAppend(
    buildPersonaAppend(persona, session.prompt_module_overrides),
    session,
    sessionId,
  )
  const config: TurnConfig = {
    sessionId,
    mode: session.mode,
    personaAppend,
    systemPromptKey: '',
    mcpDefinitionKey: JSON.stringify({
      configured: configuredMcpModelSurface(mcpConfig),
      builtIn: builtInMcpModelSurfaces(),
    }),
    cwd: readDirs.cwd,
    additionalDirectories: readDirs.additionalDirectories,
    sdkModel: sdkModelForProvider(model, cred),
    effort,
    thinking,
    sdkMcpServers: toSdkMcpServers(mcpConfig),
    disabledTools: disabledMcpTools(mcpConfig),
    webSettings,
    permanentAllowRules: permissions.ok ? permissionRuleStrings(permissions.rules) : [],
    cred,
    laneId,
    envOverrides,
    model,
    providerId,
    providerLabel,
  }
  config.systemPromptKey = cacheRelevantFingerprint(config).sdkCacheRelevantOptionsHash
  return { persona, config, sessionSnapshot: sessionResult, resumeHint, laneId }
}
