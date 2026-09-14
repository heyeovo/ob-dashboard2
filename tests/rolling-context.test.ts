import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { buildRollingWindowAppend, buildRollingWindowHistory } from '@/app/lib/cc/windowPrompt'
import {
  assertFixedMigrationSeed,
  assertRollingResumeRecovered,
  assertRollingSeedAvailable,
  assertRequiredRollingRevisionSeed,
  buildRollingTranscriptEntries,
  createFixedTranscriptMigrationSeed,
  createManualRollingBodyRecoverySeed,
  createRollingHistoryRevisionSeed,
  createRollingHistorySeed,
  createRollingTranscriptRecoverySeed,
  inspectRollingHistoryTranscript,
  materializeRollingHistorySeed,
  materializeRollingNativeSession,
  openRollingHistoryResume,
  rollingRevisionRequiresSource,
  syncRollingNativeSession,
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
    expect(seed?.entries.every(entry => entry.ob2HavenTurnId === 3)).toBe(true)
    expect((seed?.entries[0].message as { content: string }).content).toBe(
      '今天的原话\n\n[北京时间 2026-09-11 20:00 周五]',
    )
    expect((seed?.entries[1].message as { content: Array<{ text: string }> }).content[0].text).toBe('今天的回应')
    expect(seed?.entries[0]).toMatchObject({
      type: 'user',
      version: '2.1.222',
      gitBranch: 'HEAD',
      permissionMode: 'default',
      promptSource: 'sdk',
      entrypoint: 'sdk-ts',
      userType: 'external',
    })
    expect(seed?.entries[0].promptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(seed?.entries[1]).toMatchObject({
      type: 'assistant',
      version: '2.1.222',
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

  it('marks every entry in an explicit Haven-body recovery seed', () => {
    const seed = createManualRollingBodyRecoverySeed(turns, {
      cwd: 'C:/workspace', fallbackModel: 'claude',
    })
    expect(seed?.source).toBe('manual_body_recovery')
    expect(seed?.entries).toHaveLength(2)
    expect(seed?.entries.every(entry => entry.ob2RollingFidelity === 'body_restored')).toBe(true)
    expect(seed?.entries.every(entry => entry.ob2HavenTurnId === 3)).toBe(true)
    expect(seed?.diagnostic?.bodyRestoredTurnCount).toBe(1)
  })

  it('restores an agent wake as a hidden wake trigger followed by its assistant message', () => {
    const entries = buildRollingTranscriptEntries([{
      ...turns[0],
      user_text: '', assistant_text: '忽然想告诉你一件事', turn_kind: 'agent_wake',
      raw_json: JSON.stringify({
        agent_wake: { cause: 'agent_schedule', reason: '想起这件事', at: '2026-09-11T03:04:00Z' },
      }),
    }], {
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'C:/workspace', fallbackModel: 'claude',
    })
    expect(entries.map(entry => (entry.message as { role: string }).role)).toEqual(['user', 'assistant'])
    expect((entries[0].message as { content: string }).content).toBe(
      '<agent_wake cause="agent_schedule" reason="想起这件事"/>\n\n[北京时间 2026-09-11 11:04 周五]',
    )
    expect((entries[1].message as { content: Array<{ text: string }> }).content[0].text).toBe('忽然想告诉你一件事')

    const fallbackEntries = buildRollingTranscriptEntries([{
      ...turns[0],
      user_text: '', assistant_text: '旧主动消息', turn_kind: 'agent_wake',
      raw_json: JSON.stringify({ agent_wake: { cause: 'agent_schedule', at: 'invalid' } }),
    }], {
      sessionId: '22222222-2222-4222-8222-222222222222',
      cwd: 'C:/workspace', fallbackModel: 'claude',
    })
    expect((fallbackEntries[0].message as { content: string }).content).toContain(
      '[北京时间 2026-09-11 20:00 周五]',
    )
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
        ['user', '今天的原话\n\n[北京时间 2026-09-11 20:00 周五]'],
        ['assistant', '今天的回应'],
        ['user', '部署前最后一句\n\n[北京时间 2026-09-11 20:00 周五]'],
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
      for (const [index, entry] of source.entries.entries()) {
        const message = entry.message as { role: string; content: Array<Record<string, unknown>> }
        if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
        message.content.unshift({
          type: 'thinking', thinking: `较早日期 thinking ${Math.floor(index / 2) + 1}`, signature: `sig-${index}`,
        })
      }
      const toolUseId = 'toolu_keep_me'
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [
        {
          type: 'user', uuid: 'native-user-2', parentUuid: source.entries.at(-1)?.uuid || null,
          sessionId: source.resumeFrom, message: { role: 'user', content: '<记忆召回>\n<memory_card>完整召回卡</memory_card>\n</记忆召回>\n\n第五天查一下' },
        },
        {
          type: 'assistant', uuid: 'native-assistant-tool', parentUuid: 'native-user-2', sessionId: source.resumeFrom,
          message: { role: 'assistant', content: [
            { type: 'thinking', thinking: '最新日期 thinking', signature: 'sig-latest' },
            { type: 'tool_use', id: toolUseId, name: 'search_chat', input: { query: '旧事' } },
          ] },
        },
        {
          type: 'user', uuid: 'native-tool-result', parentUuid: 'native-assistant-tool', sessionId: source.resumeFrom,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: '完整工具结果' }] },
        },
        {
          type: 'assistant', uuid: 'native-assistant-final', parentUuid: 'native-tool-result', sessionId: source.resumeFrom,
          message: { role: 'assistant', content: [
            { type: 'redacted_thinking', data: '最新日期加密 thinking' },
            { type: 'text', text: '第五天回复' },
          ] },
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
      expect(JSON.stringify(revised?.entries)).not.toContain('较早日期 thinking 2')
      expect(JSON.stringify(revised?.entries)).not.toContain('较早日期 thinking 3')
      expect(JSON.stringify(revised?.entries)).not.toContain('较早日期 thinking 4')
      expect(JSON.stringify(revised?.entries)).toContain('最新日期 thinking')
      expect(JSON.stringify(revised?.entries)).toContain('最新日期加密 thinking')
      expect(revised?.diagnostic).toMatchObject({
        sourceSessionId: source.resumeFrom,
        sourceEntryCount: 12,
        retainedEnvelopeCount: 4,
        bodyRestoredTurnCount: 0,
        thinkingPrunedBlockCount: 3,
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

  it('keeps thinking when an older envelope has an unmatched tool call', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-unfinished-tool-'))
    const olderTurn = {
      ...turns[0], id: 1, round_id: 1, chat_day: '2026-09-10',
      user_text: '较早问题', assistant_text: '较早回答',
    } as HavenTurn
    const latestTurn = {
      ...turns[0], id: 2, round_id: 2, chat_day: '2026-09-11',
      user_text: '最新问题', assistant_text: '最新回答',
    } as HavenTurn
    try {
      const source = createRollingHistorySeed([olderTurn, latestTurn], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      const olderAssistant = source.entries[1].message as {
        role: string
        content: Array<Record<string, unknown>>
      }
      olderAssistant.content = [
        { type: 'thinking', thinking: '不能清理的 thinking', signature: 'sig-unfinished' },
        { type: 'tool_use', id: 'toolu_unfinished', name: 'search_chat', input: { query: '未完成' } },
        ...olderAssistant.content,
      ]
      await materializeRollingHistorySeed(source)

      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [olderTurn, latestTurn], [olderTurn, latestTurn],
        {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [olderTurn.chat_day, latestTurn.chat_day],
        },
      )
      expect(JSON.stringify(revised?.entries)).toContain('不能清理的 thinking')
      expect(revised?.diagnostic?.thinkingPrunedBlockCount).toBe(0)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('preserves recall, tools and images across two revisions and a disk reopen', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-lifecycle-'))
    const firstTurn = {
      ...turns[0], id: 11, round_id: 11, chat_day: '2026-09-12',
      user_text: '第一次查询', assistant_text: '第一次完成',
    } as HavenTurn
    const secondTurn = {
      ...turns[0], id: 12, round_id: 12, chat_day: '2026-09-13',
      user_text: '看这张图', assistant_text: '第二次完成',
    } as HavenTurn
    try {
      const source = createRollingHistorySeed([firstTurn], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      const firstUser = source.entries[0].message as { role: string; content: unknown }
      firstUser.content = '<记忆召回>\n<memory_card>第一次召回</memory_card>\n</记忆召回>\n\n第一次查询'
      const firstAssistant = source.entries[1].message as { role: string; content: unknown }
      firstAssistant.content = [
        { type: 'tool_use', id: 'toolu_first', name: 'search_chat', input: { query: '第一次' } },
        { type: 'text', text: '第一次完成' },
      ]
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [{
          type: 'user', uuid: 'first-result', parentUuid: source.entries[1].uuid,
          sessionId: source.resumeFrom,
          message: { role: 'user', content: [{
            type: 'tool_result', tool_use_id: 'toolu_first', content: '第一次工具结果',
          }] },
        }],
      )

      const revisionOne = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [firstTurn], [firstTurn], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [firstTurn.chat_day],
        },
      )
      await materializeRollingHistorySeed(revisionOne)

      await revisionOne!.sessionStore.append(
        { projectKey: '', sessionId: revisionOne!.resumeFrom },
        [
          {
            type: 'user', uuid: 'second-user', parentUuid: revisionOne!.entries.at(-1)?.uuid || null,
            sessionId: revisionOne!.resumeFrom,
            message: { role: 'user', content: [
              { type: 'text', text: '<记忆召回>\n<memory_card>第二次召回</memory_card>\n</记忆召回>\n\n看这张图' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
            ] },
          },
          {
            type: 'assistant', uuid: 'second-tool', parentUuid: 'second-user',
            sessionId: revisionOne!.resumeFrom,
            message: { role: 'assistant', content: [
              { type: 'tool_use', id: 'toolu_second', name: 'breath', input: { query: '图片' } },
            ] },
          },
          {
            type: 'user', uuid: 'second-result', parentUuid: 'second-tool',
            sessionId: revisionOne!.resumeFrom,
            message: { role: 'user', content: [{
              type: 'tool_result', tool_use_id: 'toolu_second', content: '第二次工具结果',
            }] },
          },
          {
            type: 'assistant', uuid: 'second-final', parentUuid: 'second-result',
            sessionId: revisionOne!.resumeFrom,
            message: { role: 'assistant', content: [{ type: 'text', text: '第二次完成' }] },
          },
        ],
      )

      const revisionTwo = await createRollingHistoryRevisionSeed(
        revisionOne!.resumeFrom, [firstTurn, secondTurn], [firstTurn, secondTurn], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [firstTurn.chat_day, secondTurn.chat_day],
        },
      )
      await materializeRollingHistorySeed(revisionTwo)

      const reopened = openRollingHistoryResume(revisionTwo!.resumeFrom, { storeRoot })
      expect(reopened).not.toBeNull()
      const audit = await inspectRollingHistoryTranscript(reopened!.resumeFrom, { storeRoot })
      expect(audit?.messages.filter(message => message.containsMemoryRecall)).toHaveLength(2)
      expect(audit?.messages.flatMap(message => message.toolNames)).toEqual(['search_chat', 'breath'])
      expect(audit?.messages.filter(message => message.blockTypes.includes('tool_result'))).toHaveLength(2)
      expect(audit?.messages.some(message => message.blockTypes.includes('image'))).toBe(true)
      expect(audit?.messages.some(message => message.content.includes('第二次工具结果'))).toBe(true)
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
      expect((restoredEntries[0].message as { content: string }).content).toBe(
        '重新加入的旧问题\n\n[北京时间 2026-09-11 20:00 周五]',
      )
      expect(JSON.stringify(restoredEntries)).not.toContain('"type":"tool_use"')
      expect(JSON.stringify(restoredEntries)).not.toContain('"type":"tool_result"')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('uses legacy transcript timestamps to distinguish repeated body text', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-legacy-repeat-'))
    const repeatedTurns = [
      {
        ...turns[0], id: 21, round_id: 21,
        user_text: '重复问题', assistant_text: '重复回答',
        created_at: '2026-09-11T12:00:00Z',
      },
      {
        ...turns[0], id: 22, round_id: 22,
        user_text: '重复问题', assistant_text: '重复回答',
        created_at: '2026-09-11T12:05:00Z',
      },
    ] as HavenTurn[]
    try {
      const source = createRollingHistorySeed(repeatedTurns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      for (const entry of source.entries) {
        delete entry.ob2HavenTurnId
        delete entry.ob2ChatDay
      }
      // 原生 transcript 记用户进入时间，Haven created_at 是回答完成后的落库时间。
      source.entries[2].timestamp = '2026-09-11T12:04:30Z'
      const repeatedUser = source.entries[2].message as { role: string; content: unknown }
      const repeatedUserText = repeatedUser.content as string
      repeatedUser.content = [
        { type: 'text', text: `<记忆召回>\n<memory_card>旧记录召回</memory_card>\n</记忆召回>\n\n${repeatedUserText}` },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'bGVnYWN5' } },
      ]
      const repeatedAssistant = source.entries[3].message as { role: string; content: unknown }
      repeatedAssistant.content = [
        { type: 'tool_use', id: 'toolu_legacy', name: 'search_chat', input: { query: '旧记录' } },
        { type: 'text', text: '重复回答' },
      ]
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [
          { type: 'custom-title', title: 'legacy source' },
          {
            type: 'user', uuid: 'legacy-result', parentUuid: source.entries[3].uuid,
            sessionId: source.resumeFrom,
            message: { role: 'user', content: [{
              type: 'tool_result', tool_use_id: 'toolu_legacy', content: '旧记录工具结果',
            }] },
          },
        ],
      )

      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, repeatedTurns, repeatedTurns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: ['2026-09-11'],
        },
      )
      expect(revised?.diagnostic?.retainedEnvelopeCount).toBe(2)
      expect(revised?.diagnostic?.bodyRestoredTurnCount).toBe(0)
      expect(revised?.diagnostic?.memoryRecallCount).toBe(1)
      expect(revised?.diagnostic?.toolUseCount).toBe(1)
      expect(revised?.diagnostic?.toolResultCount).toBe(1)
      expect(JSON.stringify(revised?.entries)).toContain('"type":"image"')
      expect(JSON.stringify(revised?.entries)).toContain('旧记录工具结果')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('uses stamped Haven turn ids when repeated turns also share a timestamp', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-id-repeat-'))
    const repeatedTurns = [
      { ...turns[0], id: 31, round_id: 31, user_text: '相同问题', assistant_text: '相同回答' },
      { ...turns[0], id: 32, round_id: 32, user_text: '相同问题', assistant_text: '相同回答' },
    ] as HavenTurn[]
    try {
      const source = createRollingHistorySeed(repeatedTurns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [{ type: 'custom-title', title: 'stamped source' }],
      )
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, repeatedTurns, repeatedTurns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: ['2026-09-11'],
        },
      )
      expect(revised?.diagnostic?.retainedEnvelopeCount).toBe(2)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('still refuses a legacy transcript that remains ambiguous after timestamp matching', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-ambiguous-repeat-'))
    const repeatedTurns = [
      { ...turns[0], id: 41, round_id: 41, user_text: '无法区分', assistant_text: '完全相同' },
      { ...turns[0], id: 42, round_id: 42, user_text: '无法区分', assistant_text: '完全相同' },
    ] as HavenTurn[]
    try {
      const source = createRollingHistorySeed([repeatedTurns[0]], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      for (const entry of source.entries) delete entry.ob2HavenTurnId
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [{ type: 'custom-title', title: 'ambiguous source' }],
      )
      await expect(createRollingHistoryRevisionSeed(
        source.resumeFrom, repeatedTurns, repeatedTurns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: ['2026-09-11'],
        },
      )).rejects.toThrow('完整轮次无法唯一对应')
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

  it('migrates a fixed-window SDK transcript with recall and tools intact', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-fixed-migration-'))
    const oldTurn = { ...turns[0], id: 1, round_id: 1, chat_day: '2026-09-09' } as HavenTurn
    const keptTurn = {
      ...turns[0], id: 2, round_id: 2, chat_day: '2026-09-13',
      user_text: '今天查一下', assistant_text: '查完了',
    } as HavenTurn
    const sourceSessionId = '11111111-1111-4111-8111-111111111111'
    const oldEntries = buildRollingTranscriptEntries([oldTurn], {
      sessionId: sourceSessionId, cwd: 'C:/workspace', fallbackModel: 'claude',
    })
    const sourceEntries = [...oldEntries,
      {
        type: 'user', uuid: 'fixed-user', parentUuid: oldEntries.at(-1)?.uuid || null,
        sessionId: sourceSessionId,
        message: { role: 'user', content: '<记忆召回>\n<memory_card>固定窗召回</memory_card>\n</记忆召回>\n\n今天查一下' },
      },
      {
        type: 'assistant', uuid: 'fixed-tool', parentUuid: 'fixed-user', sessionId: sourceSessionId,
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_fixed', name: 'breath', input: { query: '今天' } }] },
      },
      {
        type: 'user', uuid: 'fixed-result', parentUuid: 'fixed-tool', sessionId: sourceSessionId,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fixed', content: '固定窗完整结果' }] },
      },
      {
        type: 'assistant', uuid: 'fixed-final', parentUuid: 'fixed-result', sessionId: sourceSessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: '查完了' }] },
      },
    ]
    try {
      const migrated = await createFixedTranscriptMigrationSeed(
        sourceSessionId, [oldTurn, keptTurn], [keptTurn], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [keptTurn.chat_day],
          importLocalSession: async (_sessionId, store) => {
            await store.append({ projectKey: 'fixed', sessionId: sourceSessionId }, sourceEntries)
          },
        },
      )
      expect(migrated?.source).toBe('fixed_transcript_migration')
      expect(JSON.stringify(migrated?.entries)).not.toContain(oldTurn.user_text)
      expect(JSON.stringify(migrated?.entries)).toContain('固定窗完整结果')
      expect(migrated?.diagnostic).toMatchObject({
        sourceSessionId, sourceEntryCount: 6, retainedEnvelopeCount: 1,
        bodyRestoredTurnCount: 0, toolUseCount: 1, toolResultCount: 1, memoryRecallCount: 1,
      })
      await materializeRollingHistorySeed(migrated)
      expect(openRollingHistoryResume(migrated!.resumeFrom, { storeRoot })).not.toBeNull()
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('materializes a new body seed before the SDK can publish its session id', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-new-seed-materialized-'))
    try {
      const seed = createRollingHistorySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      expect(openRollingHistoryResume(seed.resumeFrom, { storeRoot })).toBeNull()
      await materializeRollingHistorySeed(seed)
      expect(openRollingHistoryResume(seed.resumeFrom, { storeRoot })).not.toBeNull()
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('materializes rolling history into Claude native storage and syncs it back', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-native-store-'))
    const claudeConfigDir = await mkdtemp(path.join(tmpdir(), 'ob2-native-claude-'))
    const cwd = await mkdtemp(path.join(tmpdir(), 'ob2-native-cwd-'))
    try {
      const seed = createRollingHistorySeed(turns, {
        sessionId: 'window-native', cwd, fallbackModel: 'claude', storeRoot,
      })!
      const materialized = await materializeRollingNativeSession(seed, cwd, { claudeConfigDir })
      expect(materialized).toMatchObject({ created: true, entryCount: seed.entries.length })
      const projectKey = path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
      const nativeFile = path.join(claudeConfigDir, 'projects', projectKey, `${seed.resumeFrom}.jsonl`)
      expect((await readFile(nativeFile, 'utf8')).trim().split(/\r?\n/)).toHaveLength(seed.entries.length)

      const updated = [...seed.entries, { ...seed.entries[0], uuid: 'synced-entry' }]
      const syncedCount = await syncRollingNativeSession(seed.resumeFrom, cwd, {
        storeRoot,
        importLocalSession: async (sessionId, store) => {
          await store.append({ projectKey: '', sessionId }, updated)
        },
      })
      expect(syncedCount).toBe(updated.length)
      const reopened = openRollingHistoryResume(seed.resumeFrom, { storeRoot })
      expect(await reopened!.sessionStore.load({ projectKey: '', sessionId: seed.resumeFrom }))
        .toHaveLength(updated.length)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
      await rm(claudeConfigDir, { recursive: true, force: true })
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('recovers a missing rolling store from the SDK transcript without dropping hidden entries', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-recovery-'))
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const sourceEntries = [
      {
        type: 'user', uuid: 'recovery-user', parentUuid: null, sessionId,
        message: { role: 'user', content: '<记忆召回>\n<memory_card>旧召回</memory_card>\n</记忆召回>\n\n查一下' },
      },
      {
        type: 'assistant', uuid: 'recovery-tool', parentUuid: 'recovery-user', sessionId,
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_recovery', name: 'breath', input: { query: '旧召回' } }] },
      },
      {
        type: 'user', uuid: 'recovery-result', parentUuid: 'recovery-tool', sessionId,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_recovery', content: '完整旧结果' }] },
      },
      {
        type: 'assistant', uuid: 'recovery-final', parentUuid: 'recovery-result', sessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: '查完了' }] },
      },
    ]
    try {
      const recovered = await createRollingTranscriptRecoverySeed(sessionId, {
        cwd: 'C:/workspace', storeRoot,
        importLocalSession: async (_sessionId, store) => {
          await store.append({ projectKey: 'default', sessionId }, sourceEntries)
        },
      })
      expect(recovered?.source).toBe('legacy_transcript_recovery')
      expect(recovered?.resumeFrom).toBe(sessionId)
      expect(recovered?.diagnostic).toMatchObject({
        sourceSessionId: sessionId, sourceEntryCount: 4, bodyRestoredTurnCount: 0,
        toolUseCount: 1, toolResultCount: 1, memoryRecallCount: 1,
      })
      await materializeRollingHistorySeed(recovered)
      const audit = await inspectRollingHistoryTranscript(sessionId, { storeRoot })
      expect(audit?.messages.some(message => message.containsMemoryRecall)).toBe(true)
      expect(audit?.messages.find(message => message.blockTypes.includes('tool_result'))?.content)
        .toContain('完整旧结果')
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

  it('requires explicit body-only consent when a fixed transcript cannot be imported', () => {
    expect(() => assertFixedMigrationSeed(true, 3, false, null))
      .toThrow('找不到固定窗口的原生 transcript')
    expect(() => assertFixedMigrationSeed(true, 3, true, null)).not.toThrow()
  })

  it('fails closed when neither rolling store nor SDK transcript can resume the same revision', () => {
    expect(() => assertRollingResumeRecovered(true, null, null))
      .toThrow('避免静默退化')
    expect(() => assertRollingResumeRecovered(true, null, createRollingHistorySeed(turns, {
      cwd: 'C:/workspace', fallbackModel: 'claude',
    }))).not.toThrow()
  })

  it('never creates a body-only rolling seed unless the transition explicitly allows it', () => {
    expect(() => assertRollingSeedAvailable(true, turns.length, null))
      .toThrow('禁止静默改用 Haven 正文')
    expect(() => assertRollingSeedAvailable(true, turns.length, createRollingHistorySeed(turns, {
      cwd: 'C:/workspace', fallbackModel: 'claude',
    }))).not.toThrow()
    expect(() => assertRollingSeedAvailable(true, 0, null)).not.toThrow()
  })

  it('returns control to the confirmed body fallback when a fixed transcript cannot align', async () => {
    const result = await createFixedTranscriptMigrationSeed(
      '11111111-1111-4111-8111-111111111111', turns, turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', requiredFullRawDays: [],
        importLocalSession: async (sessionId, store) => {
          await store.append({ projectKey: 'fixed', sessionId }, [{
            type: 'user', uuid: 'manual-command', parentUuid: null, sessionId,
            message: { role: 'user', content: '/compact' },
          }])
        },
      },
    )
    expect(result).toBeNull()
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
