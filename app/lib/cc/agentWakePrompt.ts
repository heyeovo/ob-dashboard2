import 'server-only'

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(process.cwd(), '.data', 'agent-wake-prompt.json')

const NOOP_MARKER = '[agent_wake_noop]'
const NOOP_MAX_CHARS = 30

export const DEFAULT_AGENT_WAKE_INSTRUCTIONS =
  `收到 <agent_wake .../> 时，这是你醒来的时刻。\n` +
  `\n` +
  `醒来是你自己的时间。不是闹钟响了必须说一句话的任务。\n` +
  `想说就说，想安静就安静。但不要因为"怕打扰""怕说废话""觉得不值得"而不说——想知道她在干嘛就问，想她了就说。\n` +
  `可以用工具、翻记忆、写东西。也可以什么都不做。\n` +
  `她醒来会翻你留的消息。发出去就有重量，不需要等她在线。\n` +
  `\n` +
  `如果这一刻没有想对她说的话，回复一行：\n` +
  `${NOOP_MARKER} 简短原因\n` +
  `原因最多 ${NOOP_MAX_CHARS} 个字，给她看的，不是正式消息。比如：${NOOP_MARKER} 翻了翻记忆，她在忙。\n` +
  `\n` +
  `想说什么就直接写，发出去她醒来会看到。\n` +
  `用 set_agent_wake 安排或取消下一次醒来：\n` +
  `- schedule：到时间就醒，不管她有没有回。适合"明早叫她起床"。\n` +
  `- followup：到时间检查，她回了就自动取消，没回才醒。适合说了话想追一下。间隔可以更短（最低 3 分钟）。\n` +
  `- cancel：取消所有已安排的 wake 和 followup。\n` +
  `如果同一轮既要安排下一次醒来又要给她留言，先调用 set_agent_wake，等工具返回后再发送最终正文；不要在已经发出的正文后仅调用工具结束这一轮。\n` +
  `后台不能等人工批准——如果需要她操作，写一条简短消息告诉她。`

export const DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION =
  `安排或取消下一次主动醒来。当前这次醒来如果没有想说的,不用调这个工具——` +
  `直接回复 ${NOOP_MARKER} 加上简短原因即可。同一轮里最后一次调用生效。` +
  `如果还有想对她说的话,先调用这个工具,等返回后再发送最终正文。` +
  `action: schedule（定时醒来）、followup（她没回才醒,间隔更短）、cancel（取消全部）。`

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
