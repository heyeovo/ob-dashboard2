import { windowMcpConfig } from '@/app/lib/windowMcp'
import 'server-only'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadMcpConfig } from '@/app/lib/ccMcp'
import { createMcpTransport, safeMcpError } from '@/app/lib/ccMcpDiscovery'
import type { CcMcpConfig, CcMcpServer } from '@/app/lib/ccMcpTypes'
import { storedMcpResult } from '@/app/lib/cc/ccOptions'
import { builtInMcpPermissionForTool, builtInMcpServers } from '@/app/lib/cc/builtInMcp'
import type { AnthropicToolDefinition } from '@/app/lib/selfhost/anthropicMessages'

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000
const DEFAULT_TOOL_TIMEOUT_MS = 30_000
const HOLD_TOOL_TIMEOUT_MS = 90_000
const MCP_RESULT_LIMIT = 20_000

export type SelfhostMcpTool = AnthropicToolDefinition & {
  serverName: string
  remoteName: string
  saveResults: boolean
  builtIn?: boolean
}

export type SelfhostMcpCall = {
  name: string
  input: Record<string, unknown>
}

export type SelfhostMcpCallResult = {
  text: string
  isError: boolean
  structuredContent?: Record<string, unknown>
  persistedResult?: string
}

export type SelfhostMcpRuntime = {
  tools: SelfhostMcpTool[]
  warnings: Array<{ server: string; error: string }>
  callTool(call: SelfhostMcpCall, signal?: AbortSignal): Promise<SelfhostMcpCallResult>
  configuredServer?(name: string): CcMcpServer | undefined
  close(): Promise<void>
}

type ConnectedServer = {
  server: CcMcpServer
  client: Client
  closeServer?: () => Promise<void>
}

function effectivePermission(server: CcMcpServer, toolName: string) {
  return server.toolPermissions?.[toolName] || server.permission
}

export function isSelfhostMcpServer(server: CcMcpServer) {
  return server.enabled && (server.transport === 'http' || server.transport === 'sse')
}

export function isSelfhostMcpToolAllowed(server: CcMcpServer, toolName: string) {
  return isEnabledInCatalog(server, toolName) && effectivePermission(server, toolName) === 'allow'
}

function publicToolName(server: CcMcpServer, remoteName: string) {
  return `mcp__${server.name}__${remoteName}`
}

function isEnabledInCatalog(server: CcMcpServer, name: string) {
  const configured = server.tools?.find(tool => tool.name === name)
  return configured?.enabled !== false
}

function structuredRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function selfhostMcpToolDescription(tool: {
  name: string
  description?: string
  title?: string
}) {
  return tool.description?.trim() || tool.title?.trim() || `MCP tool ${tool.name}`
}

export function selfhostMcpToolTimeout(serverTimeout: number | undefined, remoteName: string): number {
  const timeout = serverTimeout || DEFAULT_TOOL_TIMEOUT_MS
  return remoteName === 'hold' ? Math.max(timeout, HOLD_TOOL_TIMEOUT_MS) : timeout
}

export async function createSelfhostMcpRuntime(signal?: AbortSignal, overrides: Record<string, boolean> = {},
  options?: { interactive: true; sessionId: string }): Promise<SelfhostMcpRuntime> {
  const connected = new Map<string, ConnectedServer>()
  const tools: SelfhostMcpTool[] = []
  const warnings: Array<{ server: string; error: string }> = []

  let config: CcMcpConfig
  try {
    config = windowMcpConfig(await loadMcpConfig(), overrides)
  } catch (error) {
    return {
      tools,
      warnings: [{ server: 'config', error: (error as Error).message || String(error) }],
      async callTool() {
        return { text: 'MCP 配置当前不可用', isError: true }
      },
      async close() {},
    }
  }

  const builtIns = options ? builtInMcpServers(options.sessionId, { ...config.builtIns, ombre_agent_wake: false }, 'chat') : {}
  const builtInConfigs: CcMcpServer[] = Object.entries(builtIns).flatMap(([name, definition]) => definition.type === 'sdk' ? [{
    name, label: name, enabled: true, transport: 'stdio', permission: 'allow', saveResults: name === 'send_image',
  }] : [])
  for (const server of [...config.servers.filter(server => !Object.hasOwn(builtIns, server.name)), ...builtInConfigs]) {
    if (signal?.aborted) break
    if (options ? !server.enabled : !isSelfhostMcpServer(server)) continue
    const timeout = server.timeout || DEFAULT_CONNECT_TIMEOUT_MS
    const client = new Client({ name: 'ob-dashboard2-selfhost', version: '1.0.0' })
    const definition = builtIns[server.name]
    const instance = definition?.type === 'sdk' ? definition.instance : undefined
    const closeServer = instance ? () => instance.close() : undefined
    const discovered: SelfhostMcpTool[] = []
    try {
      if (instance) {
        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
        await instance.connect(serverTransport)
        await client.connect(clientTransport, { timeout, signal })
      } else await client.connect(createMcpTransport(server), { timeout, signal })
      connected.set(server.name, { server, client, closeServer })
      let cursor: string | undefined
      do {
        const result = await client.listTools(cursor ? { cursor } : undefined, { timeout, signal })
        for (const tool of result.tools) {
          if (tool.name === 'room') continue
          const name = publicToolName(server, tool.name)
          const permission = instance ? builtInMcpPermissionForTool(name, config.builtIns, config.builtInPermissions)
            : effectivePermission(server, name)
          if (options ? !isEnabledInCatalog(server, name) || permission === 'deny'
            : !isSelfhostMcpToolAllowed(server, name)) continue
          discovered.push({
            name,
            description: selfhostMcpToolDescription(tool),
            input_schema: structuredRecord(tool.inputSchema) || { type: 'object', properties: {} },
            serverName: server.name,
            remoteName: tool.name,
            saveResults: server.saveResults,
            ...(instance ? { builtIn: true } : {}),
          })
        }
        cursor = result.nextCursor
      } while (cursor)
      tools.push(...discovered)
    } catch (error) {
      warnings.push({ server: server.name, error: safeMcpError(error, server) })
      await client.close().catch(() => undefined)
      await closeServer?.().catch(() => undefined)
      connected.delete(server.name)
    }
  }

  return {
    tools,
    warnings,
    configuredServer: name => connected.get(name)?.server,
    async callTool(call, callSignal) {
      const tool = tools.find(item => item.name === call.name)
      if (!tool) return { text: `工具 ${call.name} 不可用或未获自动允许`, isError: true }
      const connection = connected.get(tool.serverName)
      if (!connection) return { text: `MCP ${tool.serverName} 当前未连接`, isError: true }
      const timeout = selfhostMcpToolTimeout(connection.server.timeout, tool.remoteName)
      try {
        const result = await connection.client.callTool(
          { name: tool.remoteName, arguments: call.input },
          undefined,
          { timeout, signal: callSignal },
        )
        const structuredContent = structuredRecord(result.structuredContent)
        const text = storedMcpResult(result, MCP_RESULT_LIMIT)
          || (options && structuredContent ? JSON.stringify(structuredContent) : '工具已完成，但没有返回正文')
        return {
          text,
          isError: result.isError === true,
          structuredContent,
          persistedResult: tool.saveResults ? text : undefined,
        }
      } catch (error) {
        return {
          text: safeMcpError(error, connection.server),
          isError: true,
        }
      }
    },
    async close() {
      await Promise.all([...connected.values()].map(async item => {
        await item.client.close().catch(() => undefined)
        await item.closeServer?.().catch(() => undefined)
      }))
      connected.clear()
    },
  }
}
