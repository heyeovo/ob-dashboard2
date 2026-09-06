import 'server-only'

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(process.cwd(), '.data', 'agent-wake-prompt.json')

const NOOP_MARKER = '[agent_wake_noop]'
const NOOP_MAX_CHARS = 30

export const DEFAULT_AGENT_WAKE_INSTRUCTIONS =
  `收到 <agent_wake .../> 时，这是你醒来的时刻。\n` +
  `\n` +
  `如果这个时刻没有想说的话、也没有想做的事，回复一行：\n` +
  `${NOOP_MARKER} 简短原因\n` +
  `原因最多 ${NOOP_MAX_CHARS} 个字，给她看的，不是正式消息。` +
  `比如：${NOOP_MARKER} 她在忙，先不打扰。\n` +
  `\n` +
  `有话想说就直接写，发出去她醒来会看到。\n` +
  `用 set_agent_wake 安排或取消下一次醒来。\n` +
  `后台不能等人工批准——如果需要她操作，写一条简短消息告诉她。`

export const DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION =
  `安排或取消下一次主动醒来。当前这次醒来如果没有想说的，不用调这个工具——` +
  `直接回复 ${NOOP_MARKER} 加上简短原因即可。同一轮里最后一次调用生效。`

export type AgentWakePromptConfig = {
  instructions: string
  tool_description: string
  updated_at: string
}

let cache: AgentWakePromptConfig | null | undefined = undefined

function loadSync(): AgentWakePromptConfig | null {
  if (cache !== undefined) return cache
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    cache = JSON.parse(raw) as AgentWakePromptConfig
  } catch {
    cache = null
  }
  return cache
}

export function getAgentWakeInstructions(): string {
  return loadSync()?.instructions || DEFAULT_AGENT_WAKE_INSTRUCTIONS
}

export function getAgentWakeToolDescription(): string {
  return loadSync()?.tool_description || DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION
}

export function getAgentWakePromptConfig(): {
  instructions: string
  tool_description: string
  default_instructions: string
  default_tool_description: string
  customized: boolean
  updated_at: string
} {
  const config = loadSync()
  return {
    instructions: config?.instructions || DEFAULT_AGENT_WAKE_INSTRUCTIONS,
    tool_description: config?.tool_description || DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION,
    default_instructions: DEFAULT_AGENT_WAKE_INSTRUCTIONS,
    default_tool_description: DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION,
    customized: config !== null,
    updated_at: config?.updated_at || '',
  }
}

export function saveAgentWakePromptConfig(
  instructions: string,
  toolDescription: string,
): AgentWakePromptConfig {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const config: AgentWakePromptConfig = {
    instructions,
    tool_description: toolDescription,
    updated_at: new Date().toISOString(),
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  cache = config
  return config
}

export function resetAgentWakePromptConfig(): void {
  try { unlinkSync(CONFIG_PATH) } catch {}
  cache = null
}
