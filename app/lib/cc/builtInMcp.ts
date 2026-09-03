import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import {
  AGENT_WAKE_SERVER_NAME,
  agentWakeMcpModelSurface,
  createAgentWakeMcpServer,
} from '@/app/lib/cc/agentWakeTool'

type BuiltInMcpRegistration = {
  name: string
  modelSurface: () => unknown
  create: (sessionId: string) => McpServerConfig
}

/**
 * 内置 MCP 的唯一注册表。以后新增同类功能时在这里同时登记实例和模型可见定义，
 * 旧窗口的 request-prefix 指纹就会自动感知变化。
 */
const BUILT_IN_MCP: BuiltInMcpRegistration[] = [{
  name: AGENT_WAKE_SERVER_NAME,
  modelSurface: agentWakeMcpModelSurface,
  create: createAgentWakeMcpServer,
}]

export function builtInMcpServers(sessionId: string): Record<string, McpServerConfig> {
  return Object.fromEntries(BUILT_IN_MCP.map(item => [item.name, item.create(sessionId)]))
}

export function builtInMcpModelSurfaces(): unknown[] {
  return BUILT_IN_MCP.map(item => item.modelSurface())
}

export function builtInMcpServerNames(): string[] {
  return BUILT_IN_MCP.map(item => item.name)
}
