export const MCP_SECRET_MASK = '********'

export type CcMcpTransport = 'stdio' | 'http' | 'sse'
export type CcMcpPermission = 'allow' | 'ask' | 'deny'

export type CcMcpToolConfig = {
  /** Agent SDK 看到的完整名称：mcp__server__tool。 */
  name: string
  title?: string
  description?: string
  /** tools/list 返回的参数结构；用于发送给模型，也用于前端预估 context。 */
  inputSchema?: Record<string, unknown>
  enabled: boolean
  readOnly?: boolean
  destructive?: boolean
  openWorld?: boolean
}

export type CcMcpServer = {
  /** Stable SDK-facing identifier. Lowercase letters, digits, and underscores only. */
  name: string
  /** Human-readable name shown in the UI. */
  label: string
  enabled: boolean
  transport: CcMcpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeout?: number
  permission: CcMcpPermission
  /** 完整 SDK 工具名（mcp__server__tool）→ 覆盖服务级默认权限。 */
  toolPermissions?: Record<string, CcMcpPermission>
  /** 最近一次 tools/list 得到的目录；开关状态跟目录一起持久化。 */
  tools?: CcMcpToolConfig[]
  lastSyncedAt?: string
  saveResults: boolean
}

export type CcMcpConfig = {
  version: 1
  servers: CcMcpServer[]
}

export type CcMcpApplySummary = {
  applied: number
  queued: number
  errors: Array<{ sessionId: string; message: string }>
}

export type CcMcpToolStatus = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  enabled: boolean
  readOnly?: boolean
  destructive?: boolean
  openWorld?: boolean
}

export type CcMcpServerStatus = {
  name: string
  status: string
  error?: string
  tools: CcMcpToolStatus[]
}
