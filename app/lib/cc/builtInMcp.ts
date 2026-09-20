import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { CcBuiltInMcpServer } from '@/app/lib/ccMcpTypes'
import {
  AGENT_WAKE_SERVER_NAME,
  AGENT_WAKE_MCP_VERSION,
  agentWakeMcpModelSurface,
  createAgentWakeMcpServer,
} from '@/app/lib/cc/agentWakeTool'

type BuiltInMcpRegistration = {
  name: string
  label: string
  version: string
  modelSurface: () => unknown
  create: (sessionId: string) => McpServerConfig
}

/**
 * 内置 MCP 的唯一注册表。以后新增同类功能时在这里同时登记实例和模型可见定义，
 * 旧窗口的 request-prefix 指纹就会自动感知变化。
 */
const BUILT_IN_MCP: BuiltInMcpRegistration[] = [{
  name: AGENT_WAKE_SERVER_NAME,
  label: 'Agent Wake',
  version: AGENT_WAKE_MCP_VERSION,
  modelSurface: agentWakeMcpModelSurface,
  create: createAgentWakeMcpServer,
}]

function enabled(item: BuiltInMcpRegistration, states: Record<string, boolean> = {}): boolean {
  return states[item.name] !== false
}

export function builtInMcpServers(
  sessionId: string,
  states: Record<string, boolean> = {},
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    BUILT_IN_MCP.filter(item => enabled(item, states)).map(item => [item.name, item.create(sessionId)]),
  )
}

export function builtInMcpModelSurfaces(states: Record<string, boolean> = {}): unknown[] {
  return BUILT_IN_MCP.filter(item => enabled(item, states)).map(item => item.modelSurface())
}

export function builtInMcpServerNames(states: Record<string, boolean> = {}): string[] {
  return BUILT_IN_MCP.filter(item => enabled(item, states)).map(item => item.name)
}

export function builtInMcpCatalog(states: Record<string, boolean> = {}): CcBuiltInMcpServer[] {
  return BUILT_IN_MCP.map(item => {
    const surface = item.modelSurface() as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return {
      name: item.name,
      label: item.label,
      enabled: enabled(item, states),
      version: item.version,
      tools: (surface.tools || []).map(tool => ({
        name: `mcp__${item.name}__${tool.name}`,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
        enabled: true,
      })),
    }
  })
}
