import 'server-only'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  MCP_SECRET_MASK,
  type CcMcpServer,
  type CcMcpServerStatus,
  type CcMcpToolConfig,
} from './ccMcpTypes'

const DEFAULT_DISCOVERY_TIMEOUT_MS = 8_000

function fetchWithHeaders(headers: Record<string, string> | undefined): typeof fetch {
  return (input, init) => {
    const merged = new Headers(init?.headers)
    for (const [name, value] of Object.entries(headers || {})) merged.set(name, value)
    return fetch(input, { ...init, headers: merged })
  }
}

function createTransport(server: CcMcpServer): Transport {
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command!,
      args: server.args,
      env: { ...getDefaultEnvironment(), ...(server.env || {}) },
      stderr: 'pipe',
    })
  }

  const url = new URL(server.url!)
  const authenticatedFetch = fetchWithHeaders(server.headers)
  if (server.transport === 'sse') {
    return new SSEClientTransport(url, { fetch: authenticatedFetch })
  }
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers: server.headers },
    fetch: authenticatedFetch,
  })
}

function safeError(error: unknown, server: CcMcpServer): string {
  let message = (error as Error)?.message || String(error)
  for (const secret of [
    ...Object.values(server.headers || {}),
    ...Object.values(server.env || {}),
  ]) {
    if (secret) message = message.replaceAll(secret, MCP_SECRET_MASK)
  }
  return message
}

export async function discoverMcpServer(server: CcMcpServer): Promise<CcMcpServerStatus> {
  if (!server.enabled) {
    return { name: server.name, status: 'disabled', tools: server.tools || [] }
  }

  const previous = new Map((server.tools || []).map(tool => [tool.name, tool]))
  const timeout = server.timeout || DEFAULT_DISCOVERY_TIMEOUT_MS
  const client = new Client({ name: 'ob-dashboard2-mcp-manager', version: '1.0.0' })

  try {
    await client.connect(createTransport(server), { timeout })
    const tools: CcMcpToolConfig[] = []
    let cursor: string | undefined

    do {
      const result = await client.listTools(cursor ? { cursor } : undefined, { timeout })
      for (const tool of result.tools) {
        const name = `mcp__${server.name}__${tool.name}`
        tools.push({
          name,
          title: tool.title,
          description: tool.description,
          enabled: previous.get(name)?.enabled !== false,
          readOnly: tool.annotations?.readOnlyHint,
          destructive: tool.annotations?.destructiveHint,
          openWorld: tool.annotations?.openWorldHint,
        })
      }
      cursor = result.nextCursor
    } while (cursor)

    return { name: server.name, status: 'connected', tools }
  } catch (error) {
    return {
      name: server.name,
      status: /401|403|unauthor|forbidden|auth/i.test((error as Error)?.message || '')
        ? 'needs-auth'
        : 'failed',
      error: safeError(error, server),
      tools: server.tools || [],
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}
