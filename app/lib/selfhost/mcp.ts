import 'server-only'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { loadMcpConfig } from '@/app/lib/ccMcp'
import { createMcpTransport, safeMcpError } from '@/app/lib/ccMcpDiscovery'
import type { CcMcpConfig, CcMcpServer } from '@/app/lib/ccMcpTypes'
import { storedMcpResult } from '@/app/lib/cc/ccOptions'
import type { AnthropicToolDefinition } from '@/app/lib/selfhost/anthropicMessages'

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000
const DEFAULT_TOOL_TIMEOUT_MS = 30_000
const MCP_RESULT_LIMIT = 20_000

export type SelfhostMcpTool = AnthropicToolDefinition & {
  serverName: string
  remoteName: string
  saveResults: boolean
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
  close(): Promise<void>
}

type ConnectedServer = {
  server: CcMcpServer
  client: Client
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

export async function createSelfhostMcpRuntime(signal?: AbortSignal): Promise<SelfhostMcpRuntime> {
  const connected = new Map<string, ConnectedServer>()
  const tools: SelfhostMcpTool[] = []
  const warnings: Array<{ server: string; error: string }> = []

  let config: CcMcpConfig
  try {
    config = await loadMcpConfig()
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

  for (const server of config.servers) {
    if (!isSelfhostMcpServer(server)) continue
    const timeout = server.timeout || DEFAULT_CONNECT_TIMEOUT_MS
    const client = new Client({ name: 'ob-dashboard2-selfhost', version: '1.0.0' })
    try {
      await client.connect(createMcpTransport(server), { timeout, signal })
      connected.set(server.name, { server, client })
      let cursor: string | undefined
      do {
        const result = await client.listTools(cursor ? { cursor } : undefined, { timeout, signal })
        for (const tool of result.tools) {
          const name = publicToolName(server, tool.name)
          if (!isSelfhostMcpToolAllowed(server, name)) continue
          tools.push({
            name,
            description: tool.description || tool.title,
            input_schema: structuredRecord(tool.inputSchema) || { type: 'object', properties: {} },
            serverName: server.name,
            remoteName: tool.name,
            saveResults: server.saveResults,
          })
        }
        cursor = result.nextCursor
      } while (cursor)
    } catch (error) {
      warnings.push({ server: server.name, error: safeMcpError(error, server) })
      await client.close().catch(() => undefined)
      connected.delete(server.name)
    }
  }

  return {
    tools,
    warnings,
    async callTool(call, callSignal) {
      const tool = tools.find(item => item.name === call.name)
      if (!tool) return { text: `工具 ${call.name} 不可用或未获自动允许`, isError: true }
      const connection = connected.get(tool.serverName)
      if (!connection) return { text: `MCP ${tool.serverName} 当前未连接`, isError: true }
      const timeout = connection.server.timeout || DEFAULT_TOOL_TIMEOUT_MS
      try {
        const result = await connection.client.callTool(
          { name: tool.remoteName, arguments: call.input },
          undefined,
          { timeout, signal: callSignal },
        )
        const text = storedMcpResult(result, MCP_RESULT_LIMIT) || '工具已完成，但没有返回正文'
        return {
          text,
          isError: result.isError === true,
          structuredContent: structuredRecord(result.structuredContent),
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
      await Promise.all([...connected.values()].map(item => item.client.close().catch(() => undefined)))
      connected.clear()
    },
  }
}
