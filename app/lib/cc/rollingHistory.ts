import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { HavenTurn } from '@/app/lib/havenTurns'

/**
 * Agent SDK streaming input uses a `user` envelope for transcript input, while
 * the nested Messages API role remains authoritative. `shouldQuery: false`
 * appends these restored turns without producing an answer; the next real user
 * message triggers the first model call with the complete role-correct history.
 */
export function rollingHistoryToSdkMessages(turns: HavenTurn[]): SDKUserMessage[] {
  const messages: SDKUserMessage[] = []
  for (const turn of turns) {
    const userText = turn.user_text.trim()
    if (userText) {
      messages.push({
        type: 'user',
        message: { role: 'user', content: userText },
        parent_tool_use_id: null,
        isSynthetic: true,
        shouldQuery: false,
        timestamp: turn.created_at,
        uuid: randomUUID(),
      })
    }
    const assistantText = turn.assistant_text.trim()
    if (assistantText) {
      messages.push({
        type: 'user',
        message: { role: 'assistant', content: assistantText },
        parent_tool_use_id: null,
        isSynthetic: true,
        shouldQuery: false,
        timestamp: turn.created_at,
        uuid: randomUUID(),
      })
    }
  }
  return messages
}
