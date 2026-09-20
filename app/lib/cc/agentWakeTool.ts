import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getAgentWakeToolDescription } from './agentWakePrompt'

export const AGENT_WAKE_SERVER_NAME = 'ombre_agent_wake'
export const AGENT_WAKE_TOOL_NAME = 'set_agent_wake'
export const AGENT_WAKE_SDK_TOOL_NAME = `mcp__${AGENT_WAKE_SERVER_NAME}__${AGENT_WAKE_TOOL_NAME}`
export const AGENT_WAKE_NOOP_MARKER = '[agent_wake_noop]'
export const AGENT_WAKE_NOOP_STATUS_MAX_CHARS = 30

export const AGENT_WAKE_MCP_VERSION = '1.2.0'
const AGENT_WAKE_TOOL_INPUT = {
  action: z.enum(['schedule', 'cancel', 'followup']),
  after_minutes: z.number().optional(),
  at: z.string().optional(),
  reason: z.string().optional(),
}

/** 可序列化的模型可见定义；新增同类内置 MCP 时也必须提供同样的 surface。 */
export function agentWakeMcpModelSurface() {
  return {
    name: AGENT_WAKE_SERVER_NAME,
    version: AGENT_WAKE_MCP_VERSION,
    alwaysLoad: true,
    tools: [{
      name: AGENT_WAKE_TOOL_NAME,
      description: getAgentWakeToolDescription(),
      alwaysLoad: true,
      inputSchema: z.toJSONSchema(z.object(AGENT_WAKE_TOOL_INPUT)),
    }],
  }
}

export function agentWakeMcpAudit() {
  const surface = agentWakeMcpModelSurface()
  return {
    version: AGENT_WAKE_MCP_VERSION,
    instructionsHash: createHash('sha256').update(surface.tools[0].description).digest('hex').slice(0, 16),
  }
}

export type CcTurnExecutionMode = 'foreground' | 'background'

export type AgentWakeDecision =
  | { action: 'cancel' }
  | { action: 'schedule'; at: string; reason: string }
  | { action: 'followup'; at: string; reason: string }

type AgentWakeTurnState = {
  mode: CcTurnExecutionMode
  minMinutes: number
  followupMinMinutes: number
  scheduleEnabled: boolean
  decision: AgentWakeDecision | null
}

const STATE_KEY = '__ob2_cc_agent_wake_turn_state__'
const states: Map<string, AgentWakeTurnState> =
  (globalThis as unknown as Record<string, Map<string, AgentWakeTurnState>>)[STATE_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, AgentWakeTurnState>>)[STATE_KEY] = new Map())

export function beginAgentWakeTurn(
  sessionId: string,
  mode: CcTurnExecutionMode,
  minMinutes = 10,
  scheduleEnabled = true,
  followupMinMinutes = 3,
): void {
  states.set(sessionId, {
    mode,
    minMinutes: Math.max(1, Math.min(10080, Math.round(minMinutes))),
    followupMinMinutes: Math.max(1, Math.min(60, Math.round(followupMinMinutes))),
    scheduleEnabled,
    decision: null,
  })
}

export function endAgentWakeTurn(sessionId: string): AgentWakeDecision | null {
  const decision = states.get(sessionId)?.decision || null
  states.delete(sessionId)
  return decision
}

export function getCcTurnExecutionMode(sessionId: string): CcTurnExecutionMode {
  return states.get(sessionId)?.mode || 'foreground'
}

export function peekAgentWakeDecision(sessionId: string): AgentWakeDecision | null {
  return states.get(sessionId)?.decision || null
}

export function isSetAgentWakeTool(toolName: string): boolean {
  return toolName === AGENT_WAKE_SDK_TOOL_NAME || toolName === AGENT_WAKE_TOOL_NAME
}

function scheduleAt(args: { after_minutes?: number; at?: string }, minMinutes: number): string {
  const hasAfter = args.after_minutes != null
  const hasAt = Boolean(args.at?.trim())
  if (hasAfter === hasAt) throw new Error('after_minutes 与 at 必须且只能提供一个')
  const now = Date.now()
  if (hasAfter) {
    const minutes = Number(args.after_minutes)
    if (!Number.isInteger(minutes) || minutes < minMinutes || minutes > 7 * 24 * 60) {
      throw new Error(`after_minutes 必须是 ${minMinutes}–10080 之间的整数`)
    }
    return new Date(now + minutes * 60_000).toISOString()
  }
  const raw = String(args.at || '').trim()
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) throw new Error('at 必须是带时区的 RFC 3339 时间')
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) throw new Error('at 不是有效时间')
  if (timestamp < now + minMinutes * 60_000) throw new Error(`下一次 wake 至少要在 ${minMinutes} 分钟后`)
  if (timestamp > now + 7 * 24 * 60 * 60_000) throw new Error('下一次 wake 最远只能设置到 7 天后')
  return new Date(timestamp).toISOString()
}

export function recordAgentWakeDecision(
  sessionId: string,
  args: { action: 'schedule' | 'cancel' | 'followup'; after_minutes?: number; at?: string; reason?: string },
): AgentWakeDecision {
  const state = states.get(sessionId)
  if (!state) throw new Error('当前没有可接收 wake 决定的 turn')
  if ((args.action === 'schedule' || args.action === 'followup') && !state.scheduleEnabled) {
    throw new Error('当前窗口没有开启允许主动唤醒')
  }
  let decision: AgentWakeDecision
  if (args.action === 'cancel') {
    decision = { action: 'cancel' }
  } else if (args.action === 'followup') {
    decision = {
      action: 'followup',
      at: scheduleAt(args, state.followupMinMinutes),
      reason: String(args.reason || '').trim(),
    }
  } else {
    decision = {
      action: 'schedule',
      at: scheduleAt(args, state.minMinutes),
      reason: String(args.reason || '').trim(),
    }
  }
  if ((decision.action === 'schedule' || decision.action === 'followup') && Array.from(decision.reason).length > 50) {
    throw new Error('reason 最多 50 个字符')
  }
  state.decision = decision
  return decision
}

export function parseAgentWakeNoop(text: string): { status: string } | null {
  const value = text.trim()
  if (!value.startsWith(AGENT_WAKE_NOOP_MARKER)) return null
  const status = Array.from(value.slice(AGENT_WAKE_NOOP_MARKER.length).trim())
    .slice(0, AGENT_WAKE_NOOP_STATUS_MAX_CHARS)
    .join('')
  return { status }
}

export function createAgentWakeMcpServer(sessionId: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: AGENT_WAKE_SERVER_NAME,
    version: AGENT_WAKE_MCP_VERSION,
    alwaysLoad: true,
    tools: [
      tool(
        AGENT_WAKE_TOOL_NAME,
        getAgentWakeToolDescription(),
        AGENT_WAKE_TOOL_INPUT,
        async args => {
          try {
            const decision = recordAgentWakeDecision(sessionId, args)
            let text: string
            if (decision.action === 'cancel') {
              text = '已记录：取消下一次 wake。'
            } else if (decision.action === 'followup') {
              text = `已记录 followup：${decision.at}（她回复后自动取消）${decision.reason ? `（${decision.reason}）` : ''}`
            } else {
              text = `已记录下一次 wake：${decision.at}${decision.reason ? `（${decision.reason}）` : ''}`
            }
            return {
              content: [{ type: 'text', text }],
            }
          } catch (error) {
            return {
              content: [{ type: 'text', text: error instanceof Error ? error.message : 'wake 参数无效' }],
              isError: true,
            }
          }
        },
        { alwaysLoad: true },
      ),
    ],
  })
}
