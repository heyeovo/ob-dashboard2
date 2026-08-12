export type HistoricalConversation = {
  source: string
  client: string
  conversation_id: string
  title: string
  message_count: number
  first_at: string
  last_at: string
}

export type HistoricalMessage = {
  id: number
  source: string
  source_event_id: string
  role: 'user' | 'assistant'
  text: string
  created_at: string
  conversation_id: string
  client: string
  metadata?: {
    thinking?: string
    has_reasoning?: boolean
    [key: string]: unknown
  }
}

export type HistoricalConversationResponse = {
  ok: boolean
  count: number
  total: number
  has_more: boolean
  items: HistoricalConversation[]
  error?: string
}

export type HistoricalMessageResponse = {
  ok: boolean
  count: number
  total: number
  has_more: boolean
  items: HistoricalMessage[]
  error?: string
}

export function historicalKey(item: Pick<HistoricalConversation, 'source' | 'conversation_id'>) {
  return `${item.source}:${item.conversation_id}`
}

export function historicalSourceLabel(source: string, client = '') {
  if (source === 'claude_official_export' || client === 'claude_official') return 'Claude'
  if (source === 'kelivo_export' || client === 'kelivo') return 'Kelivo'
  return client || source || '历史'
}
