import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import {
  assertProductionMcpUrl,
  getHavenGatewayConnection,
  isProductionEnvironment,
  joinHavenUrl,
  redactHavenSecrets,
} from './havenConfig'
import {
  MCP_SECRET_MASK,
  type CcMcpConfig,
  type CcMcpPermission,
  type CcMcpServer,
  type CcMcpToolConfig,
  type CcMcpTransport,
} from './ccMcpTypes'

const LEGACY_CONFIG_PATH = path.join(process.cwd(), '.data', 'cc-mcp.json')
const HAVEN_MCP_PATH = '/gateway/api/cc/mcp'

// 本机开发沿用 Ombre-Brain-Haven/.mcp.json 对应的旧默认值。
// production 不读取这个 localhost fallback，缺失配置时保持 MCP 空清单。
const DEVELOPMENT_DEFAULT_CONFIG: CcMcpConfig = {
  version: 1,
  servers: [
    {
      name: 'ombre_brain',
      label: 'Ombre Brain',
      enabled: true,
      transport: 'http',
      url: 'http://127.0.0.1:18001/mcp',
      permission: 'allow',
      saveResults: true,
    },
  ],
}

type McpState = {
  config: CcMcpConfig | null
  loading: Promise<CcMcpConfig> | null
}

const STATE_KEY = '__ob2_cc_mcp_state__'
const state: McpState =
  (globalThis as unknown as Record<string, McpState>)[STATE_KEY] ||
  ((globalThis as unknown as Record<string, McpState>)[STATE_KEY] = {
    config: null,
    loading: null,
  })

function cloneConfig(config: CcMcpConfig): CcMcpConfig {
  return JSON.parse(JSON.stringify(config)) as CcMcpConfig
}

export function fallbackMcpConfig(): CcMcpConfig {
  return isProductionEnvironment()
    ? { version: 1, servers: [] }
    : cloneConfig(DEVELOPMENT_DEFAULT_CONFIG)
}

function cleanRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim()
    if (!name) continue
    out[name] = String(item ?? '')
  }
  return out
}

function cleanTransport(value: unknown): CcMcpTransport {
  // Claude 的 .mcp.json 把新 HTTP transport 写成 streamable-http；
  // Agent SDK 的 Options 类型里对应的是 http。
  if (value === 'stdio') return 'stdio'
  if (value === 'sse') return 'sse'
  if (value === 'streamable-http') return 'http'
  return 'http'
}

function cleanPermission(value: unknown): CcMcpPermission {
  if (value === 'allow' || value === 'deny') return value
  return 'ask'
}

export function canonicalMcpId(value: string): string {
  let id = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

  if (id && !/^[a-z]/.test(id)) id = `mcp_${id}`
  return id.slice(0, 64).replace(/_+$/g, '')
}

function canonicalToolName(value: string, serverId: string): string {
  const name = value.trim()
  if (!name.startsWith('mcp__')) return name
  const toolSeparator = name.indexOf('__', 5)
  if (toolSeparator < 0) return name
  return `mcp__${serverId}__${name.slice(toolSeparator + 2)}`
}

function cleanToolPermissions(
  value: unknown,
  serverId: string,
): Record<string, CcMcpPermission> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, CcMcpPermission> = {}
  for (const [key, permission] of Object.entries(value as Record<string, unknown>)) {
    const name = canonicalToolName(key, serverId)
    if (!name) continue
    out[name] = cleanPermission(permission)
  }
  return out
}

function cleanTools(value: unknown, serverId: string): CcMcpToolConfig[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tools: CcMcpToolConfig[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const name = canonicalToolName(String(raw.name || ''), serverId)
    if (!name.startsWith('mcp__') || seen.has(name)) continue
    seen.add(name)
    tools.push({
      name,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      inputSchema:
        raw.inputSchema && typeof raw.inputSchema === 'object' && !Array.isArray(raw.inputSchema)
          ? raw.inputSchema as Record<string, unknown>
          : undefined,
      enabled: raw.enabled !== false,
      readOnly: typeof raw.readOnly === 'boolean' ? raw.readOnly : undefined,
      destructive: typeof raw.destructive === 'boolean' ? raw.destructive : undefined,
      openWorld: typeof raw.openWorld === 'boolean' ? raw.openWorld : undefined,
    })
  }
  return tools
}

function normalizeServer(value: unknown): CcMcpServer {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const timeoutValue = Number(raw.timeout)
  const originalName = String(raw.name || '').trim()
  const name = canonicalMcpId(originalName)
  return {
    name,
    label:
      (typeof raw.label === 'string' && raw.label.trim()) ||
      originalName ||
      name,
    enabled: raw.enabled !== false,
    transport: cleanTransport(raw.transport || raw.type),
    command: typeof raw.command === 'string' ? raw.command.trim() : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(item => String(item)) : [],
    env: cleanRecord(raw.env),
    url: typeof raw.url === 'string' ? raw.url.trim() : undefined,
    headers: cleanRecord(raw.headers),
    timeout:
      Number.isFinite(timeoutValue) && timeoutValue >= 1000
        ? Math.round(timeoutValue)
        : undefined,
    permission: cleanPermission(raw.permission),
    toolPermissions: cleanToolPermissions(raw.toolPermissions, name),
    tools: cleanTools(raw.tools, name),
    lastSyncedAt:
      typeof raw.lastSyncedAt === 'string' && raw.lastSyncedAt
        ? raw.lastSyncedAt
        : undefined,
    saveResults: raw.saveResults !== false,
  }
}

export function validateMcpConfig(value: unknown): CcMcpConfig {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const servers = Array.isArray(raw.servers) ? raw.servers.map(normalizeServer) : []
  const names = new Set<string>()

  for (const server of servers) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(server.name)) {
      throw new Error(`MCP 内部 ID「${server.name || '空'}」只能用小写字母、数字和单下划线，并且必须以字母开头`)
    }
    if (names.has(server.name)) throw new Error(`MCP 名称重复：${server.name}`)
    names.add(server.name)

    if (server.transport === 'stdio') {
      if (!server.command) throw new Error(`MCP「${server.name}」缺少启动命令`)
    } else {
      if (!server.url) throw new Error(`MCP「${server.name}」缺少 URL`)
      let parsed: URL
      try {
        parsed = new URL(server.url)
      } catch {
        throw new Error(`MCP「${server.name}」的 URL 不正确`)
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`MCP「${server.name}」只接受 http/https URL`)
      }
      assertProductionMcpUrl(server.url)
    }
  }

  return { version: 1, servers }
}

function mergeMaskedRecord(
  incoming: Record<string, string> | undefined,
  previous: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(incoming || {})) {
    out[key] =
      value === MCP_SECRET_MASK && previous && Object.prototype.hasOwnProperty.call(previous, key)
        ? previous[key]
        : value
  }
  return out
}

function mergeMaskedSecrets(config: CcMcpConfig, previous: CcMcpConfig): CcMcpConfig {
  const oldByName = new Map(previous.servers.map(server => [server.name, server]))
  return {
    version: 1,
    servers: config.servers.map(server => {
      const old = oldByName.get(server.name)
      return {
        ...server,
        env: mergeMaskedRecord(server.env, old?.env),
        headers: mergeMaskedRecord(server.headers, old?.headers),
      }
    }),
  }
}

function maskedRecord(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.keys(value || {}).map(key => [key, MCP_SECRET_MASK]),
  )
}

export function publicMcpConfig(config: CcMcpConfig): CcMcpConfig {
  return {
    version: 1,
    servers: config.servers.map(server => ({
      ...server,
      env: maskedRecord(server.env),
      headers: maskedRecord(server.headers),
    })),
  }
}

type HavenMcpResult = {
  ok: boolean
  payload: Record<string, unknown>
  error: string
}

async function havenMcpFetch(
  method: 'GET' | 'POST',
  config?: CcMcpConfig,
): Promise<HavenMcpResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  try {
    const { baseUrl, token } = getHavenGatewayConnection()
    const res = await fetch(joinHavenUrl(baseUrl, HAVEN_MCP_PATH), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(config ? { 'Content-Type': 'application/json' } : {}),
      },
      body: config ? JSON.stringify(config) : undefined,
      signal: ac.signal,
      cache: 'no-store',
    })
    const raw = await res.text()
    if (!res.ok) {
      return { ok: false, payload: {}, error: redactHavenSecrets(`HTTP ${res.status}: ${raw.slice(0, 300)}`) }
    }
    try {
      return { ok: true, payload: JSON.parse(raw) as Record<string, unknown>, error: '' }
    } catch {
      return { ok: false, payload: {}, error: redactHavenSecrets(`非 JSON 响应: ${raw.slice(0, 200)}`) }
    }
  } catch (error) {
    const err = error as Error
    return {
      ok: false,
      payload: {},
      error: err.name === 'AbortError'
        ? 'MCP 配置请求 Haven 超时'
        : redactHavenSecrets(String(err.message || err)),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function legacyOrDefaultConfig(): Promise<CcMcpConfig> {
  if (isProductionEnvironment()) return fallbackMcpConfig()
  try {
    const text = await readFile(LEGACY_CONFIG_PATH, 'utf8')
    return validateMcpConfig(JSON.parse(text))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[cc-mcp] 旧配置迁移读取失败，使用默认配置：', (error as Error).message)
    }
    return fallbackMcpConfig()
  }
}

export async function loadMcpConfig(): Promise<CcMcpConfig> {
  if (state.loading) return cloneConfig(await state.loading)

  state.loading = (async () => {
    const loaded = await havenMcpFetch('GET')
    if (loaded.ok) {
      const remote = loaded.payload.config
      if (
        remote &&
        typeof remote === 'object' &&
        !Array.isArray(remote) &&
        Array.isArray((remote as Record<string, unknown>).servers)
      ) {
        return validateMcpConfig(remote)
      }

      // Haven 第一次部署还没有这一行：优先迁移旧本机文件；Vercel 没旧文件时写入默认值。
      const initial = await legacyOrDefaultConfig()
      const seeded = await havenMcpFetch('POST', initial)
      if (seeded.ok) return validateMcpConfig(seeded.payload.config)
      console.warn('[cc-mcp] 初始配置写入 Haven 失败：', seeded.error)
      return initial
    }

    if (isProductionEnvironment()) {
      throw new Error(`production 无法读取 Haven MCP 配置，MCP 已禁用：${loaded.error}`)
    }
    console.warn('[cc-mcp] Haven 配置读取失败，临时使用当前进程缓存：', loaded.error)
    return state.config ? validateMcpConfig(state.config) : legacyOrDefaultConfig()
  })()

  try {
    state.config = await state.loading
    return cloneConfig(state.config)
  } finally {
    state.loading = null
  }
}

export async function saveMcpConfig(value: unknown): Promise<CcMcpConfig> {
  const previous = await loadMcpConfig()
  const clean = mergeMaskedSecrets(validateMcpConfig(value), previous)
  const saved = await havenMcpFetch('POST', clean)
  if (!saved.ok) throw new Error(`MCP 配置保存到 Haven 失败：${saved.error}`)
  state.config = validateMcpConfig(saved.payload.config)
  return cloneConfig(state.config)
}

export function toSdkMcpServers(config: CcMcpConfig): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {}
  for (const server of config.servers) {
    if (!server.enabled) continue
    if (server.transport === 'stdio') {
      out[server.name] = {
        type: 'stdio',
        command: server.command!,
        args: server.args?.length ? server.args : undefined,
        env: Object.keys(server.env || {}).length ? server.env : undefined,
        timeout: server.timeout,
        alwaysLoad: true,
      }
    } else {
      assertProductionMcpUrl(server.url!)
      out[server.name] = {
        type: server.transport,
        url: server.url!,
        headers: Object.keys(server.headers || {}).length ? server.headers : undefined,
        timeout: server.timeout,
        alwaysLoad: true,
      }
    }
  }
  return out
}

export function disabledMcpTools(config: CcMcpConfig): string[] {
  return config.servers.flatMap(server =>
    server.enabled
      ? (server.tools || []).filter(tool => !tool.enabled).map(tool => tool.name)
      : [],
  )
}

/**
 * 只描述模型能看到的 MCP 表面，不包含密钥、地址或 handler。
 * tools/list 重新同步或启停后，这份定义会变化并触发旧窗口重建 query。
 */
export function configuredMcpModelSurface(config: CcMcpConfig) {
  return config.servers
    .filter(server => server.enabled)
    .map(server => ({
      name: server.name,
      alwaysLoad: true,
      tools: (server.tools || [])
        .filter(tool => tool.enabled)
        .map(tool => ({
          name: tool.name,
          title: tool.title || '',
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        })),
    }))
}

function serverForTool(toolName: string): CcMcpServer | null {
  if (!toolName.startsWith('mcp__')) return null
  const config = state.config
  if (!config) return null
  return (
    config.servers.find(
      server => server.enabled && toolName.startsWith(`mcp__${server.name}__`),
    ) || null
  )
}

export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__')
}

export function mcpPermissionForTool(toolName: string): CcMcpPermission {
  const server = serverForTool(toolName)
  const tool = server?.tools?.find(item => item.name === toolName)
  if (tool && !tool.enabled) return 'deny'
  return server?.toolPermissions?.[toolName] || server?.permission || 'ask'
}

export function shouldSaveMcpResult(toolName: string): boolean {
  return serverForTool(toolName)?.saveResults === true
}
