import type { CcMcpConfig, CcMcpServer, CcMcpToolConfig } from './ccMcpTypes'

const CJK_OR_WIDE = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g

/**
 * Claude 与 selfhost 模型没有共同 tokenizer。沿用 handoff 的保守口径：
 * 中日韩宽字符约 1.3 token，其余字符约 0.25 token。所有 UI 必须标成「预估」。
 */
export function estimateContextTokens(value: string): number {
  const text = String(value || '')
  if (!text) return 0
  const wide = text.match(CJK_OR_WIDE)?.length || 0
  return Math.ceil(wide * 1.3 + (text.length - wide) / 4)
}

/** 按 Claude 实际接收的 tool definition 形状估算；固定余量覆盖 JSON 分隔和协议包装。 */
export function estimateMcpToolTokens(tool: CcMcpToolConfig): number {
  const definition = JSON.stringify({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    input_schema: tool.inputSchema || { type: 'object', properties: {} },
  })
  return estimateContextTokens(definition) + 12
}

export function estimateMcpServerTokens(server: CcMcpServer): number {
  if (!server.enabled) return 0
  return (server.tools || []).reduce(
    (sum, tool) => sum + (tool.enabled ? estimateMcpToolTokens(tool) : 0),
    0,
  )
}

export function estimateMcpConfigTokens(config: CcMcpConfig): number {
  return config.servers.reduce((sum, server) => sum + estimateMcpServerTokens(server), 0)
}

/** Claude Code 内置 Web 工具 schema 不由 SDK 暴露，只能给保守预估。 */
export function estimateWebToolTokens(searchEnabled: boolean, fetchEnabled: boolean): number {
  return (searchEnabled ? 700 : 0) + (fetchEnabled ? 700 : 0)
}
