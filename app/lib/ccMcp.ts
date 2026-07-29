import 'server-only'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import {
  MCP_SECRET_MASK,
  type CcMcpConfig,
  type CcMcpPermission,
  type CcMcpServer,
  type CcMcpToolConfig,
  type CcMcpTransport,
} from './ccMcpTypes'

const DATA_DIR = path.join(process.cwd(), '.data')
const CONFIG_PATH = path.join(DATA_DIR, 'cc-mcp.json')

// 用户现有的 OB MCP（Ombre-Brain-Haven/.mcp.json）作为第一条默认配置。
// 它是本机 HTTP 服务，不带密钥；没启动时只会显示连接失败，不影响聊天。
const DEFAULT_CONFIG: CcMcpConfig = {
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

function validateConfig(value: unknown): CcMcpConfig {
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

async function writeConfigFile(config: CcMcpConfig): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  const tempPath = `${CONFIG_PATH}.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(tempPath, CONFIG_PATH)
}

export async function loadMcpConfig(): Promise<CcMcpConfig> {
  if (state.config) {
    const clean = validateConfig(state.config)
    if (JSON.stringify(clean) !== JSON.stringify(state.config)) {
      await writeConfigFile(clean)
    }
    state.config = clean
    return cloneConfig(clean)
  }
  if (state.loading) return cloneConfig(await state.loading)

  state.loading = (async () => {
    try {
      const text = await readFile(CONFIG_PATH, 'utf8')
      const raw = JSON.parse(text)
      const clean = validateConfig(raw)
      if (JSON.stringify(clean) !== JSON.stringify(raw)) {
        await writeConfigFile(clean)
      }
      return clean
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return cloneConfig(DEFAULT_CONFIG)
      console.warn('[cc-mcp] 配置读取失败，退回默认配置：', (error as Error).message)
      return cloneConfig(DEFAULT_CONFIG)
    }
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
  const clean = mergeMaskedSecrets(validateConfig(value), previous)
  await writeConfigFile(clean)
  state.config = clean
  return cloneConfig(clean)
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
