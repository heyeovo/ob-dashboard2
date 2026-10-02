import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { getAgentWakeToolDescription } from './agentWakePrompt'

export const AGENT_WAKE_SERVER_NAME = 'ombre_agent_wake'
export const AGENT_WAKE_TOOL_NAME = 'set_agent_wake'
export const AGENT_WAKE_SDK_TOOL_NAME = `mcp__${AGENT_WAKE_SERVER_NAME}__${AGENT_WAKE_TOOL_NAME}`
export const AGENT_WAKE_NOOP_MARKER = '[agent_wake_noop]'
export const AGENT_WAKE_NOOP_STATUS_MAX_CHARS = 30

export const AGENT_WAKE_MCP_VERSION = '1.3.0'
const AGENT_WAKE_TOOL_INPUT = {
  action: z.enum(['schedule', 'cancel', 'followup', 'list']),
  alarm_id: z.string().optional(),
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
  | { action: 'cancel'; alarm_id?: string; at?: string }
  | { action: 'schedule'; alarm_id: string; at: string; reason: string }
  | { action: 'followup'; at: string; reason: string }

export type AgentWakeAlarm = { alarm_id: string; at: string; reason: string }

type AgentWakeTurnState = {
  mode: CcTurnExecutionMode
  minMinutes: number
  followupMinMinutes: number
  scheduleEnabled: boolean
  alarms: AgentWakeAlarm[]
  followup: { at: string; reason: string } | null
  ops: AgentWakeDecision[]
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
  alarms: AgentWakeAlarm[] = [],
  followupAt = '',
): void {
  states.set(sessionId, {
    mode,
    minMinutes: Math.max(1, Math.min(10080, Math.round(minMinutes))),
    followupMinMinutes: Math.max(1, Math.min(60, Math.round(followupMinMinutes))),
    scheduleEnabled,
    alarms: alarms.map(alarm => ({ ...alarm })),
    followup: followupAt ? { at: followupAt, reason: '' } : null,
    ops: [],
  })
}

export function endAgentWakeTurn(sessionId: string): AgentWakeDecision[] {
  const decision = states.get(sessionId)?.ops || []
  states.delete(sessionId)
  return decision
}

export function getCcTurnExecutionMode(sessionId: string): CcTurnExecutionMode {
  return states.get(sessionId)?.mode || 'foreground'
}

export function peekAgentWakeDecision(sessionId: string): AgentWakeDecision | null {
  return states.get(sessionId)?.ops.at(-1) || null
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
  args: { action: 'schedule' | 'cancel' | 'followup' | 'list'; alarm_id?: string; after_minutes?: number; at?: string; reason?: string },
): AgentWakeDecision | { action: 'list' } {
  const state = states.get(sessionId)
  if (!state) throw new Error('当前没有可接收 wake 决定的 turn')
  if (args.action === 'list') return { action: 'list' }
  if ((args.action === 'schedule' || args.action === 'followup') && !state.scheduleEnabled) {
    throw new Error('当前窗口没有开启允许主动唤醒')
  }
  let decision: AgentWakeDecision
  if (args.action === 'cancel') {
    const alarm = args.alarm_id ? state.alarms.find(item => item.alarm_id === args.alarm_id) : undefined
    if (args.alarm_id && !alarm) throw new Error('alarm_id 不存在')
    decision = args.alarm_id ? { action: 'cancel', alarm_id: args.alarm_id, at: alarm!.at } : { action: 'cancel' }
  } else if (args.action === 'followup') {
    decision = {
      action: 'followup',
      at: scheduleAt(args, state.followupMinMinutes),
      reason: String(args.reason || '').trim(),
    }
  } else {
    if (state.alarms.length >= 5) throw new Error('最多同时挂 5 个闹钟，先取消一个')
    let alarmId: string
    do { alarmId = `w_${randomBytes(3).toString('hex')}` } while (state.alarms.some(item => item.alarm_id === alarmId))
    decision = {
      action: 'schedule',
      alarm_id: alarmId,
      at: scheduleAt(args, state.minMinutes),
      reason: String(args.reason || '').trim(),
    }
  }
  if ((decision.action === 'schedule' || decision.action === 'followup') && Array.from(decision.reason).length > 50) {
    throw new Error('reason 最多 50 个字符')
  }
  if (decision.action === 'schedule') state.alarms.push(decision)
  else if (decision.action === 'followup') state.followup = decision
  else if (decision.alarm_id) state.alarms = state.alarms.filter(item => item.alarm_id !== decision.alarm_id)
  else { state.alarms = []; state.followup = null }
  state.ops.push(decision)
  return decision
}

export function formatAgentWakeTime(at: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

export function agentWakeTurnSummary(sessionId: string): string {
  const state = states.get(sessionId)
  if (!state) return ''
  const lines = [...state.alarms].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map(item => `${item.alarm_id} · ${formatAgentWakeTime(item.at)} · ${item.reason}`)
  if (!lines.length) lines.push('没有挂着的闹钟')
  if (state.followup) lines.push(`followup · ${formatAgentWakeTime(state.followup.at)} · ${state.followup.reason}（她回复后自动取消）`)
  return lines.join('\n')
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
            if (decision.action === 'list') {
              text = '当前闹钟：'
            } else if (decision.action === 'cancel') {
              text = decision.alarm_id ? `已记录：取消 ${decision.alarm_id}。` : '已记录：取消全部闹钟和 followup。'
            } else if (decision.action === 'followup') {
              text = `已记录 followup：${decision.at}（她回复后自动取消）${decision.reason ? `（${decision.reason}）` : ''}`
            } else {
              text = `已记录下一次 wake：${decision.at}${decision.reason ? `（${decision.reason}）` : ''}`
            }
            return {
              content: [{ type: 'text', text: `${text}\n${agentWakeTurnSummary(sessionId)}` }],
            }
          } catch (error) {
            return {
              content: [{ type: 'text', text: `${error instanceof Error ? error.message : 'wake 参数无效'}\n${agentWakeTurnSummary(sessionId)}` }],
              isError: true,
            }
          }
        },
        { alwaysLoad: true },
      ),
    ],
  })
}
