import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { CcMode } from '@/app/lib/ccModes'
import type { CcBuiltInMcpPermission, CcBuiltInMcpServer, CcMcpPermission } from '@/app/lib/ccMcpTypes'
import {
  AGENT_WAKE_SERVER_NAME,
  AGENT_WAKE_MCP_VERSION,
  agentWakeMcpModelSurface,
  createAgentWakeMcpServer,
} from '@/app/lib/cc/agentWakeTool'
import {
  YANZHI_FILES_MCP_VERSION,
  YANZHI_FILES_SERVER_NAME,
  createYanzhiFilesMcpServer,
  yanzhiFilesMcpModelSurface,
} from '@/app/lib/cc/yanzhiFilesTool'

type BuiltInMcpRegistration = {
  name: string
  label: string
  version: string
  modes?: CcMode[]
  defaultPermission: CcBuiltInMcpPermission
  permissionConfigurable?: boolean
  modelSurface: () => unknown
  create: (sessionId: string) => McpServerConfig
}

/**
 * 内置 MCP 的唯一注册表。以后新增同类功能时在这里同时登记实例和模型可见定义，
 * 旧窗口的 request-prefix 指纹就会自动感知变化。
 */
const BUILT_IN_MCP: BuiltInMcpRegistration[] = [
  {
    name: AGENT_WAKE_SERVER_NAME,
    label: 'Agent Wake',
    version: AGENT_WAKE_MCP_VERSION,
    defaultPermission: 'allow',
    modelSurface: agentWakeMcpModelSurface,
    create: createAgentWakeMcpServer,
  },
  {
    name: YANZHI_FILES_SERVER_NAME,
    label: "yanzhi's files",
    version: YANZHI_FILES_MCP_VERSION,
    modes: ['chat'],
    defaultPermission: 'allow',
    permissionConfigurable: true,
    modelSurface: yanzhiFilesMcpModelSurface,
    create: createYanzhiFilesMcpServer,
  },
]

function enabled(item: BuiltInMcpRegistration, states: Record<string, boolean> = {}): boolean {
  return states[item.name] !== false
}

function appliesToMode(item: BuiltInMcpRegistration, mode?: CcMode): boolean {
  return !mode || !item.modes || item.modes.includes(mode)
}

export function builtInMcpServers(
  sessionId: string,
  states: Record<string, boolean> = {},
  mode?: CcMode,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    BUILT_IN_MCP
      .filter(item => enabled(item, states) && appliesToMode(item, mode))
      .map(item => [item.name, item.create(sessionId)]),
  )
}

export function builtInMcpModelSurfaces(states: Record<string, boolean> = {}, mode?: CcMode): unknown[] {
  return BUILT_IN_MCP
    .filter(item => enabled(item, states) && appliesToMode(item, mode))
    .map(item => item.modelSurface())
}

export function builtInMcpServerNames(states: Record<string, boolean> = {}, mode?: CcMode): string[] {
  return BUILT_IN_MCP
    .filter(item => enabled(item, states) && appliesToMode(item, mode))
    .map(item => item.name)
}

export function builtInMcpPermissionForTool(
  toolName: string,
  states: Record<string, boolean> = {},
  permissions: Record<string, CcBuiltInMcpPermission> = {},
): CcMcpPermission | null {
  const item = BUILT_IN_MCP.find(candidate => toolName.startsWith(`mcp__${candidate.name}__`))
  if (!item) return null
  if (!enabled(item, states)) return 'deny'
  return item.permissionConfigurable ? permissions[item.name] || item.defaultPermission : item.defaultPermission
}

export function builtInMcpCatalog(
  states: Record<string, boolean> = {},
  permissions: Record<string, CcBuiltInMcpPermission> = {},
): CcBuiltInMcpServer[] {
  return BUILT_IN_MCP.map(item => {
    const surface = item.modelSurface() as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }
    return {
      name: item.name,
      label: item.label,
      enabled: enabled(item, states),
      version: item.version,
      permission: item.permissionConfigurable ? permissions[item.name] || item.defaultPermission : item.defaultPermission,
      permissionConfigurable: item.permissionConfigurable === true,
      tools: (surface.tools || []).map(tool => ({
        name: `mcp__${item.name}__${tool.name}`,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
        enabled: true,
      })),
    }
  })
}
