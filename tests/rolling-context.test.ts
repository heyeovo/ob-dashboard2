import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { buildRollingWindowAppend, buildRollingWindowHistory } from '@/app/lib/cc/windowPrompt'
import {
  assertRequiredRollingRevisionSeed,
  buildRollingTranscriptEntries,
  createRollingHistoryRevisionSeed,
  createRollingHistorySeed,
  inspectRollingHistoryTranscript,
  materializeRollingHistorySeed,
  openRollingHistoryResume,
  rollingRevisionRequiresSource,
} from '@/app/lib/cc/rollingHistory'
import { ccResumeHintForContext, ccResumeKey } from '@/app/lib/ccSession'
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

  it('keeps a rolling transcript available after the in-memory store is replaced', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-store-'))
    try {
      const seed = createRollingHistorySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      const appended = buildRollingTranscriptEntries([{ ...turns[0], user_text: '部署前最后一句' }], {
        sessionId: seed.resumeFrom, cwd: 'C:/workspace', fallbackModel: 'claude',
      })
      await seed.sessionStore.append(
        { projectKey: 'any', sessionId: seed.resumeFrom },
        appended,
      )

      const reopened = openRollingHistoryResume(seed.resumeFrom, { storeRoot })
      expect(reopened?.source).toBe('persisted')
      expect(await reopened?.sessionStore.load({
        projectKey: 'another-process', sessionId: seed.resumeFrom,
      })).toEqual([...seed.entries, ...appended])
      const audit = await inspectRollingHistoryTranscript(seed.resumeFrom, { storeRoot })
      expect(audit?.entryCount).toBe(4)
      expect(audit?.messages.map(message => [message.role, message.content])).toEqual([
        ['user', '今天的原话'],
        ['assistant', '今天的回应'],
        ['user', '部署前最后一句'],
        ['assistant', '今天的回应'],
      ])
      expect(audit?.messages.every(message => !message.containsRollingWindowContext)).toBe(true)
      expect(openRollingHistoryResume('11111111-1111-4111-8111-111111111111', { storeRoot })).toBeNull()
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('drops only exited-day envelopes and preserves native tool use/result order for remaining raw days', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-revision-'))
    const sourceTurns = Array.from({ length: 5 }, (_, index) => ({
      ...turns[0], id: index + 1, round_id: index + 1,
      chat_day: `2026-09-${String(index + 7).padStart(2, '0')}`,
      user_text: index === 4 ? '第五天查一下' : `第${index + 1}天`,
      assistant_text: index === 4 ? '第五天回复' : `第${index + 1}天回复`,
    })) as HavenTurn[]
    try {
      const source = createRollingHistorySeed(sourceTurns.slice(0, 4), {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      const toolUseId = 'toolu_keep_me'
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [
        {
          type: 'user', uuid: 'native-user-2', parentUuid: source.entries.at(-1)?.uuid || null,
          sessionId: source.resumeFrom, message: { role: 'user', content: '<记忆召回>\n<memory_card>完整召回卡</memory_card>\n</记忆召回>\n\n第五天查一下' },
        },
        {
          type: 'assistant', uuid: 'native-assistant-tool', parentUuid: 'native-user-2', sessionId: source.resumeFrom,
          message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'search_chat', input: { query: '旧事' } }] },
        },
        {
          type: 'user', uuid: 'native-tool-result', parentUuid: 'native-assistant-tool', sessionId: source.resumeFrom,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: '完整工具结果' }] },
        },
        {
          type: 'assistant', uuid: 'native-assistant-final', parentUuid: 'native-tool-result', sessionId: source.resumeFrom,
          message: { role: 'assistant', content: [{ type: 'text', text: '第五天回复' }] },
        },
      ])

      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, sourceTurns, sourceTurns.slice(1),
        {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: sourceTurns.slice(1).map(turn => turn.chat_day),
        },
      )
      expect(revised?.source).toBe('revision_seed')
      expect(revised?.entries).toHaveLength(10)
      expect(JSON.stringify(revised?.entries)).not.toContain('第1天')
      expect(revised?.entries.map(entry => (entry.message as { role: string }).role))
        .toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
      expect(JSON.stringify(revised?.entries[7])).toContain(toolUseId)
      expect(JSON.stringify(revised?.entries[8])).toContain('完整工具结果')
      expect(revised?.diagnostic).toMatchObject({
        sourceSessionId: source.resumeFrom,
        sourceEntryCount: 12,
        retainedEnvelopeCount: 4,
        bodyRestoredTurnCount: 0,
        toolUseCount: 1,
        toolResultCount: 1,
        memoryRecallCount: 1,
      })
      await materializeRollingHistorySeed(revised)
      expect(openRollingHistoryResume(revised!.resumeFrom, { storeRoot })).not.toBeNull()
      const audit = await inspectRollingHistoryTranscript(revised!.resumeFrom, { storeRoot })
      expect(audit?.messages.find(message => message.blockTypes.includes('tool_use'))?.toolNames).toEqual(['search_chat'])
      expect(audit?.messages.find(message => message.blockTypes.includes('tool_result'))?.content).toContain('完整工具结果')
      expect(audit?.messages.some(message => message.containsMemoryRecall)).toBe(true)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('restores a newly re-added raw day from Haven body text only and marks the downgrade', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-restore-'))
    const sourceTurn = { ...turns[0], id: 1, round_id: 1, chat_day: '2026-09-11' } as HavenTurn
    const restoredTurn = {
      ...turns[0], id: 2, round_id: 2, chat_day: '2026-09-10',
      user_text: '重新加入的旧问题', assistant_text: '重新加入的旧回答',
    } as HavenTurn
    try {
      const source = createRollingHistorySeed([sourceTurn], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [])
      // 空 append 不会物化；追加一个无 UUID 的非消息标记，同时落下初始 transcript。
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [{ type: 'custom-title', title: 'source' }],
      )
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [sourceTurn, restoredTurn], [sourceTurn, restoredTurn],
        {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [sourceTurn.chat_day],
        },
      )
      const restoredEntries = revised?.entries.filter(entry => entry.ob2HavenTurnId === 2) || []
      expect(restoredEntries.map(entry => (entry.message as { role: string }).role)).toEqual(['user', 'assistant'])
      expect(restoredEntries.every(entry => entry.ob2RollingFidelity === 'body_restored')).toBe(true)
      expect(JSON.stringify(restoredEntries)).not.toContain('"type":"tool_use"')
      expect(JSON.stringify(restoredEntries)).not.toContain('"type":"tool_result"')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('refuses to body-restore a turn from a day that stayed raw', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-required-'))
    const retained = { ...turns[0], id: 1, chat_day: '2026-09-11' } as HavenTurn
    const missing = {
      ...turns[0], id: 2, round_id: 2, chat_day: '2026-09-12',
      user_text: '持久副本里缺失的问题', assistant_text: '持久副本里缺失的回答',
    } as HavenTurn
    try {
      const source = createRollingHistorySeed([retained], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [{ type: 'custom-title', title: 'source' }],
      )
      await expect(createRollingHistoryRevisionSeed(
        source.resumeFrom, [retained, missing], [retained, missing],
        {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [retained.chat_day, missing.chat_day],
        },
      )).rejects.toThrow('仍为 raw 的完整轮次：2026-09-12')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('keeps native Claude resume points isolated by revision', () => {
    expect(ccResumeKey('session-a', 'subscription', 7)).toBe('session-a::subscription::context-7')
    expect(ccResumeKey('session-a', 'subscription', 8)).not.toBe(ccResumeKey('session-a', 'subscription', 7))
  })

  it('fails closed for daily rolling revisions when the prior strategy or source is uncertain', () => {
    expect(rollingRevisionRequiresSource(true, 0, 1, 'daily_rolling')).toBe(true)
    expect(rollingRevisionRequiresSource(true, 0, 1, '')).toBe(true)
    expect(rollingRevisionRequiresSource(true, 0, 1, 'fixed_window')).toBe(false)
    expect(rollingRevisionRequiresSource(true, 1, 1, 'daily_rolling')).toBe(false)
    expect(() => assertRequiredRollingRevisionSeed(true, 4, '', null))
      .toThrow('无法确定旧滚动 transcript')
    expect(() => assertRequiredRollingRevisionSeed(true, 4, 'old-session', null))
      .toThrow('旧滚动 transcript 持久副本不存在或无法完整对齐')
  })

  it('resumes a rolling Claude session only while its context revision still matches', () => {
    expect(ccResumeHintForContext({
      persistedHint: ' native-session ', legacyHint: '',
      laneContextRevision: 7, contextRevision: 7, isRolling: true,
    })).toBe('native-session')
    expect(ccResumeHintForContext({
      persistedHint: 'native-session', legacyHint: '',
      laneContextRevision: 7, contextRevision: 8, isRolling: true,
    })).toBe('')
    expect(ccResumeHintForContext({
      persistedHint: '', legacyHint: 'legacy-session',
      laneContextRevision: 0, contextRevision: 0, isRolling: false,
    })).toBe('legacy-session')
  })

  it('uses permanent per-message ids when restoring history', () => {
    const restored = turnsToMessages([{ ...turns[0], source: 'cc' }])
    expect(restored.map(message => message.id)).toEqual(['msg_user_3', 'msg_assistant_3'])
    expect(restored.every(message => message.chatDay === '2026-09-11')).toBe(true)
  })
})
