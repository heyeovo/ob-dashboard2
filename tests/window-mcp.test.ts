import { createHash } from 'node:crypto'
import { buildCcOptions, type TurnConfig } from '@/app/lib/cc/ccOptions'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { effectiveMcp, windowMcpConfig, windowMcpToolDisabled } from '@/app/lib/windowMcp'
import { configuredMcpModelSurface, disabledMcpTools, toSdkMcpServers, validateMcpConfig, publicMcpConfig, loadMcpConfig, saveMcpConfig, windowMcpPermissionForTool } from '@/app/lib/ccMcp'
import { builtInMcpModelSurfaces, builtInMcpPermissionForTool, builtInMcpServerNames } from '@/app/lib/cc/builtInMcp'

const sessionMock = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/havenTurns', () => ({ getConversationSession: sessionMock }))
beforeEach(() => { vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'test-token') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })
const fixture = () => validateMcpConfig({
  servers: [{ name: 'games', label: 'Games', enabled: true, transport: 'http', url: 'https://example.com/mcp', permission: 'allow', tools: [{ name: 'mcp__games__play', enabled: true }, { name: 'mcp__games__hidden', enabled: false }] }],
  builtIns: { ombre_agent_wake: true, yanzhi: true, send_image: true },
})
function legacyAssembly(config: ReturnType<typeof fixture>, mode: 'chat' | 'work') {
  return {
    mcpDefinitionKey: JSON.stringify({ configured: configuredMcpModelSurface(config), builtIn: builtInMcpModelSurfaces(config.builtIns, mode) }),
    mcpServers: toSdkMcpServers(config),
    disallowedTools: disabledMcpTools(config),
    builtInNames: builtInMcpServerNames(config.builtIns, mode),
  }
}

function sdkOptions(config: ReturnType<typeof fixture>, mode: 'chat' | 'work' = 'chat') {
  const assembled = legacyAssembly(config, mode)
  const turn: TurnConfig = {
    sessionId: 'window', mode, personaAppend: '', systemPromptKey: '', modelSurfaceKey: '',
    mcpDefinitionKey: assembled.mcpDefinitionKey, builtInMcpStates: config.builtIns,
    sdkMcpServers: assembled.mcpServers, disabledTools: assembled.disallowedTools,
    cwd: process.cwd(), additionalDirectories: [], sdkModel: 'test', effort: '', thinking: true,
    webSettings: DEFAULT_WEB_SETTINGS, permanentAllowRules: [], cred: 'api', laneId: 'api:default',
    envOverrides: {}, model: 'test', providerId: '', providerLabel: '',
  }
  return buildCcOptions(turn, null)
}

describe('window MCP', () => {
  it('implements every global/default/override branch', () => {
    for (const global of [false, true]) for (const defaults of [false, true, undefined]) for (const override of [false, true, undefined]) {
      expect(effectiveMcp(global, defaults, override)).toBe(global && (override ?? defaults ?? true))
    }
  })
  it.each(['chat', 'work'] as const)('preserves legacy serialized SDK configuration and definition key in %s', mode => {
    const config = fixture()
    const before = JSON.stringify(legacyAssembly(config, mode))
    // Golden hashes of the unchanged pre-feature assembly (definition key + SDK config + tool denies).
    expect(createHash('sha256').update(before).digest('hex')).toBe(mode === 'chat'
      ? 'b542a597c0ab67285b26b8c7a6bb698e14033613321f185ea1b19fa3bbf8ac5e'
      : '8565241bc889a1640a0bc0c7dc47fbd627c78053cb110e8360c4c5582d919f56')
    expect(JSON.stringify(legacyAssembly(windowMcpConfig(config), mode))).toBe(before)
    const oldOptions = sdkOptions(config, mode)
    const newOptions = sdkOptions(windowMcpConfig(config), mode)
    expect(Object.keys(newOptions.mcpServers || {})).toEqual(Object.keys(oldOptions.mcpServers || {}))
    // SDK built-in instances contain mutable transports; compare the full serializable config and identity.
    const sdkSurface = (options: typeof oldOptions) => Object.entries(options.mcpServers || {}).map(([name, server]) =>
      [name, server.type === 'sdk' ? { type: server.type, name: server.name } : server])
    expect(JSON.stringify(sdkSurface(newOptions))).toBe(JSON.stringify(sdkSurface(oldOptions)))
    expect(JSON.stringify(newOptions.disallowedTools)).toBe(JSON.stringify(oldOptions.disallowedTools))
    expect(JSON.stringify(legacyAssembly(windowMcpConfig({ ...config, builtInDefaults: { send_image: true, yanzhi: true }, servers: config.servers.map(server => ({ ...server, defaultInWindows: true })) }), mode))).toBe(before)
  })
  it('filters configured and built-in definitions, and denies cached tools', () => {
    const config = fixture()
    const overrides = { games: false, send_image: false, yanzhi: false }
    const effective = windowMcpConfig(config, overrides)
    expect(toSdkMcpServers(effective)).toEqual({})
    expect(configuredMcpModelSurface(effective)).toEqual([])
    expect(disabledMcpTools(effective)).toEqual([])
    expect(builtInMcpServerNames(effective.builtIns)).toEqual(['ombre_agent_wake'])
    expect(builtInMcpPermissionForTool('mcp__send_image__send_image', effective.builtIns)).toBe('deny')
    for (const name of ['games', 'send_image', 'yanzhi']) expect(windowMcpToolDisabled(`mcp__${name}__tool`, config, overrides)).toBe(true)
    expect(legacyAssembly(windowMcpConfig(config, overrides), 'chat').mcpDefinitionKey).not.toBe(legacyAssembly(config, 'chat').mcpDefinitionKey)
    expect(legacyAssembly(windowMcpConfig(config), 'chat')).toEqual(legacyAssembly(config, 'chat'))
  })
  it('follows defaults and cannot override global disable', () => {
    const config = fixture()
    config.servers[0].defaultInWindows = false
    config.builtInDefaults = { send_image: false }
    expect(toSdkMcpServers(windowMcpConfig(config))).toEqual({})
    expect(toSdkMcpServers(windowMcpConfig(config, { games: true }))).toHaveProperty('games')
    config.servers[0].enabled = false
    config.builtIns!.send_image = false
    expect(toSdkMcpServers(windowMcpConfig(config, { games: true }))).toEqual({})
    expect(windowMcpToolDisabled('mcp__send_image__send_image', config, { send_image: true })).toBe(true)
  })
  it('roundtrips built-in defaults through validation, public masking and Haven save', async () => {
    const config = fixture()
    config.builtInDefaults = { yanzhi: false, send_image: false }
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify({ config: init?.body ? JSON.parse(String(init.body)) : config })))
    vi.stubGlobal('fetch', fetchMock)
    const saved = await saveMcpConfig(publicMcpConfig(config))
    expect(saved.builtInDefaults).toEqual(config.builtInDefaults)
    expect(publicMcpConfig(await loadMcpConfig()).builtInDefaults).toEqual(config.builtInDefaults)
    expect((await saveMcpConfig({ servers: config.servers })).builtInDefaults).toEqual(config.builtInDefaults)
  })
  it('rechecks window permission on every cached callback invocation and fails closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ config: fixture() }))))
    await loadMcpConfig()
    sessionMock.mockResolvedValue({ ok: true, session: { mcp_overrides: { games: false, send_image: false } } })
    expect(await windowMcpPermissionForTool('mcp__games__play', 'window')).toBe('deny')
    expect(await windowMcpPermissionForTool('mcp__send_image__send_image', 'window')).toBe('deny')
    const options = sdkOptions(windowMcpConfig(fixture(), { games: false, send_image: false }))
    expect(options.mcpServers).not.toHaveProperty('games')
    expect(options.mcpServers).not.toHaveProperty('send_image')
    const hook = options.hooks!.PreToolUse![0].hooks[0]
    for (const name of ['mcp__games__play', 'mcp__send_image__send_image']) {
      expect(await options.canUseTool!(name, {}, { signal: new AbortController().signal } as never)).toMatchObject({ behavior: 'deny' })
      expect(await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: {} } as never, undefined, { signal: new AbortController().signal })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } })
    }
    sessionMock.mockResolvedValue({ ok: true, session: { mcp_overrides: {} } })
    expect(await windowMcpPermissionForTool('mcp__games__play', 'window')).toBe('allow')
    sessionMock.mockResolvedValue({ ok: false })
    expect(await windowMcpPermissionForTool('mcp__games__play', 'window')).toBe('deny')
  })
})
