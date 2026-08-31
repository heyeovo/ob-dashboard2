import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

export const AGENT_WAKE_SERVER_NAME = 'ombre_agent_wake'
export const AGENT_WAKE_TOOL_NAME = 'set_agent_wake'
export const AGENT_WAKE_SDK_TOOL_NAME = `mcp__${AGENT_WAKE_SERVER_NAME}__${AGENT_WAKE_TOOL_NAME}`
export const AGENT_WAKE_NOOP_MARKER = '[agent_wake_noop]'

export type CcTurnExecutionMode = 'foreground' | 'background'

export type AgentWakeDecision =
  | { action: 'cancel' }
  | { action: 'schedule'; at: string; reason: string }

type AgentWakeTurnState = {
  mode: CcTurnExecutionMode
  decision: AgentWakeDecision | null
}

const STATE_KEY = '__ob2_cc_agent_wake_turn_state__'
const states: Map<string, AgentWakeTurnState> =
  (globalThis as unknown as Record<string, Map<string, AgentWakeTurnState>>)[STATE_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, AgentWakeTurnState>>)[STATE_KEY] = new Map())

export function beginAgentWakeTurn(sessionId: string, mode: CcTurnExecutionMode): void {
  states.set(sessionId, { mode, decision: null })
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

function scheduleAt(args: { after_minutes?: number; at?: string }): string {
  const hasAfter = args.after_minutes != null
  const hasAt = Boolean(args.at?.trim())
  if (hasAfter === hasAt) throw new Error('after_minutes 与 at 必须且只能提供一个')
  const now = Date.now()
  if (hasAfter) {
    const minutes = Number(args.after_minutes)
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 7 * 24 * 60) {
      throw new Error('after_minutes 必须是 10–10080 之间的整数')
    }
    return new Date(now + minutes * 60_000).toISOString()
  }
  const raw = String(args.at || '').trim()
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) throw new Error('at 必须是带时区的 RFC 3339 时间')
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) throw new Error('at 不是有效时间')
  if (timestamp < now + 10 * 60_000) throw new Error('下一次 wake 至少要在 10 分钟后')
  if (timestamp > now + 7 * 24 * 60 * 60_000) throw new Error('下一次 wake 最远只能设置到 7 天后')
  return new Date(timestamp).toISOString()
}

export function recordAgentWakeDecision(
  sessionId: string,
  args: { action: 'schedule' | 'cancel'; after_minutes?: number; at?: string; reason?: string },
): AgentWakeDecision {
  const state = states.get(sessionId)
  if (!state) throw new Error('当前没有可接收 wake 决定的 turn')
  const decision: AgentWakeDecision = args.action === 'cancel'
    ? { action: 'cancel' }
    : {
        action: 'schedule',
        at: scheduleAt(args),
        reason: String(args.reason || '').trim(),
      }
  if (decision.action === 'schedule' && Array.from(decision.reason).length > 30) {
    throw new Error('reason 最多 30 个字符')
  }
  state.decision = decision
  return decision
}

export function createAgentWakeMcpServer(sessionId: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: AGENT_WAKE_SERVER_NAME,
    version: '1.0.0',
    alwaysLoad: true,
    instructions:
      `When the user message is an <agent_wake .../> trigger, decide whether anything useful ` +
      `should happen now. If nothing should be shown or done, reply with exactly ${AGENT_WAKE_NOOP_MARKER}. ` +
      `Use set_agent_wake only to schedule or cancel a future wake. Background turns cannot wait for ` +
      `human approval; if user action is needed, send a normal concise assistant message explaining it.`,
    tools: [
      tool(
        AGENT_WAKE_TOOL_NAME,
        'Set or cancel the next wake for this CC session. The last valid call in this turn wins.',
        {
          action: z.enum(['schedule', 'cancel']),
          after_minutes: z.number().optional(),
          at: z.string().optional(),
          reason: z.string().optional(),
        },
        async args => {
          try {
            const decision = recordAgentWakeDecision(sessionId, args)
            return {
              content: [{
                type: 'text',
                text: decision.action === 'cancel'
                  ? '已记录：取消下一次 wake。'
                  : `已记录下一次 wake：${decision.at}${decision.reason ? `（${decision.reason}）` : ''}`,
              }],
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
