import { describe, expect, it } from 'vitest'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { buildRollingWindowAppend, buildRollingWindowHistory } from '@/app/lib/cc/windowPrompt'
import { buildRollingTranscriptEntries, createRollingHistorySeed } from '@/app/lib/cc/rollingHistory'
import { ccResumeKey } from '@/app/lib/ccSession'
import { turnsToMessages } from '@/app/cc/ccHistory'
import type { ConversationContextDay, HavenConversationSession, HavenTurn } from '@/app/lib/havenTurns'

const session = {
  context_revision: 7,
  rolling_context: {
    strategy: 'daily_rolling',
    timezone: 'Asia/Shanghai',
    day_start_hour: 4,
    day_modes: {
      '2026-09-10': 'review',
      '2026-09-11': 'raw',
      '2026-09-09': 'omit',
    },
  },
} as HavenConversationSession

const days = [
  { day: '2026-09-09', turn_count: 1, raw_chars: 10, first_turn_id: 1, last_turn_id: 1, review: null },
  { day: '2026-09-10', turn_count: 1, raw_chars: 20, first_turn_id: 2, last_turn_id: 2, review: { content: '这天的回顾', chars: 6, updated_at: '' } },
  { day: '2026-09-11', turn_count: 1, raw_chars: 30, first_turn_id: 3, last_turn_id: 3, review: null },
] satisfies ConversationContextDay[]

const turns = [{
  id: 3,
  user_message_id: 'msg_user_3',
  assistant_message_id: 'msg_assistant_3',
  chat_day: '2026-09-11',
  user_text: '今天的原话',
  assistant_text: '今天的回应',
  created_at: '2026-09-11T12:00:00Z',
}] as HavenTurn[]

describe('daily rolling context', () => {
  it('keeps reviews and pinned buckets in system context but removes raw transcript text', () => {
    const text = buildRollingWindowAppend(session, turns, days, [{ id: 'pin-1', title: '固定关系事实', content: '一直要知道的内容' }])
    expect(text).toContain('revision="7"')
    expect(text).toContain('实时钉选记忆｜固定关系事实｜pin-1')
    expect(text).toContain('【2026-09-10 日回顾】\n这天的回顾')
    expect(text).not.toContain('【2026-09-11 完整对话原文】')
    expect(text).not.toContain('今天的原话')
    expect(text).not.toContain('今天的回应')
    expect(text).not.toContain('2026-09-09')
  })

  it('restores raw days as a native user/assistant transcript seed', async () => {
    const history = buildRollingWindowHistory(session, turns, days)
    const seed = createRollingHistorySeed(history, { cwd: 'C:/workspace', fallbackModel: 'claude' })
    expect(history.map(turn => turn.id)).toEqual([3])
    expect(seed?.entries.map(entry => (entry.message as { role: string }).role)).toEqual(['user', 'assistant'])
    expect((seed?.entries[0].message as { content: string }).content).toBe('今天的原话')
    expect((seed?.entries[1].message as { content: Array<{ text: string }> }).content[0].text).toBe('今天的回应')
    expect(seed?.entries[0]).toMatchObject({
      type: 'user',
      version: '2.1.220',
      gitBranch: 'HEAD',
      permissionMode: 'default',
      promptSource: 'sdk',
      entrypoint: 'sdk-ts',
      userType: 'external',
    })
    expect(seed?.entries[0].promptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(seed?.entries[1]).toMatchObject({
      type: 'assistant',
      version: '2.1.220',
      gitBranch: 'HEAD',
      userType: 'external',
      message: {
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
          service_tier: 'standard',
        },
      },
    })
    expect(seed?.entries[1].requestId).toMatch(/^req_01[0-9a-f]{32}$/)
    expect(await seed?.sessionStore.load({ projectKey: 'any', sessionId: seed.resumeFrom })).toEqual(seed?.entries)
    const parsed = await getSessionMessages(seed!.resumeFrom, {
      dir: 'C:/workspace',
      sessionStore: seed!.sessionStore,
    })
    expect(parsed.map(message => message.message.role)).toEqual(['user', 'assistant'])
  })

  it('restores an agent wake as a hidden wake trigger followed by its assistant message', () => {
    const entries = buildRollingTranscriptEntries([{
      ...turns[0],
      user_text: '', assistant_text: '忽然想告诉你一件事', turn_kind: 'agent_wake',
      raw_json: JSON.stringify({ agent_wake: { cause: 'agent_schedule', reason: '想起这件事' } }),
    }], {
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'C:/workspace', fallbackModel: 'claude',
    })
    expect(entries.map(entry => (entry.message as { role: string }).role)).toEqual(['user', 'assistant'])
    expect((entries[0].message as { content: string }).content).toBe(
      '<agent_wake cause="agent_schedule" reason="想起这件事"/>',
    )
    expect((entries[1].message as { content: Array<{ text: string }> }).content[0].text).toBe('忽然想告诉你一件事')
  })

  it('keeps native Claude resume points isolated by revision', () => {
    expect(ccResumeKey('session-a', 'subscription', 7)).toBe('session-a::subscription::context-7')
    expect(ccResumeKey('session-a', 'subscription', 8)).not.toBe(ccResumeKey('session-a', 'subscription', 7))
  })

  it('uses permanent per-message ids when restoring history', () => {
    const restored = turnsToMessages([{ ...turns[0], source: 'cc' }])
    expect(restored.map(message => message.id)).toEqual(['msg_user_3', 'msg_assistant_3'])
    expect(restored.every(message => message.chatDay === '2026-09-11')).toBe(true)
  })
})
