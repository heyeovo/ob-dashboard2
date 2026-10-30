import type { ConversationContextDay, RollingContextConfig } from '@/app/lib/havenTurns'

export type DayReceipt = {
  day: string
  treatment: 'full' | 'pruned' | 'removed' | 'body_restored'
  thinkingPrunedBlockCount?: number
  memoryRecallPrunedBlockCount?: number
  imagePrunedBlockCount?: number
}
export const formatContextTokens = (value: number) => value ? `${(value / 1000).toFixed(1)}k` : '0'
export const contextParts = ['conversation', 'thinking', 'tools', 'attachments', 'recall', 'other'] as const
export type ContextParts = Record<typeof contextParts[number], number>
export function dayParts(day: ConversationContextDay, mode: 'raw' | 'review' | 'omit', treatment: DayReceipt | null, prune: boolean): ContextParts {
  const parts: ContextParts = { conversation: 0, thinking: 0, tools: 0, attachments: 0, recall: 0, other: 0 }
  if (mode === 'omit') return parts
  if (mode === 'review') return { ...parts, conversation: day.review?.estimated_tokens ?? Math.ceil((day.review?.content.length || 0) * 1.3) }
  const e = day.token_estimate
  parts.conversation = e?.conversation ?? Math.ceil(day.raw_chars * 1.3)
  parts.thinking = e?.thinking || 0
  parts.tools = e?.tools || 0
  parts.attachments = e?.attachments || 0
  parts.recall = e?.recall || 0
  parts.other = (e?.timestamps || 0) + (e?.message_overhead || 0) + (e?.agent_wake || 0)
  if (treatment?.treatment === 'body_restored') {
    parts.thinking = parts.tools = parts.attachments = parts.recall = 0
  } else {
    if (prune || treatment?.treatment === 'pruned' || (treatment?.memoryRecallPrunedBlockCount || 0) > 0) parts.recall = 0
    if (prune || treatment?.treatment === 'pruned' && treatment.imagePrunedBlockCount !== undefined || (treatment?.imagePrunedBlockCount || 0) > 0) parts.attachments = Math.max(0, parts.attachments - (e?.attachment_image_tokens || 0))
    if ((treatment?.thinkingPrunedBlockCount || 0) > 0) parts.thinking = 0
  }
  return parts
}
export const sumParts = (parts: ContextParts) => Object.values(parts).reduce((sum, value) => sum + value, 0)
export function currentDayMode(day: string, config: RollingContextConfig, receipt?: DayReceipt, revisionLastDay?: string) {
  if (!receipt && revisionLastDay && day > revisionLastDay) return 'raw'
  if (receipt?.treatment === 'removed') return config.day_modes[day] === 'review' ? 'review' : 'omit'
  if (receipt) return 'raw'
  return config.day_modes[day] || 'raw'
}
