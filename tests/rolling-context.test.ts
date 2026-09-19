import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
const api = vi.hoisted(() => ({ getBuckets: vi.fn(), getJournals: vi.fn() }))

vi.mock('@/app/lib/api', () => ({
  getBuckets: api.getBuckets,
  getJournals: api.getJournals,
}))

import { buildRollingWindowAppend, buildRollingWindowHistory, loadRollingWindowAppend } from '@/app/lib/cc/windowPrompt'
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
  inspectRollingHistoryAlignment,
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

  it('adds selected rolling memory groups once even when a bucket appears in two groups', () => {
    const text = buildRollingWindowAppend(
      session,
      turns,
      days,
      [{ id: 'pin-1', title: '固定关系事实', content: '一直要知道的内容' }],
      [{ id: 'journal-1', title: '某篇日记', content: '日记正文', author: '小羊' }],
      [{ id: 'recent-1', title: '最近记忆', content: '最近正文' }],
      [{ id: 'feel-1', title: '最近感受', content: '感受正文' }],
      [
        { id: 'recent-1', title: '重复记忆', content: '不应重复' },
        { id: 'high-1', title: '旧高重要度', content: '高重要度正文' },
      ],
    )
    expect(text).toContain('【日记｜某篇日记｜小羊｜journal-1】\n日记正文')
    expect(text).toContain('【最近记忆｜最近记忆｜recent-1】\n最近正文')
    expect(text).toContain('【feel｜最近感受｜feel-1】\n感受正文')
    expect(text).toContain('【随机高重要度记忆｜旧高重要度｜high-1】\n高重要度正文')
    expect(text).not.toContain('不应重复')
  })

  it('reports saved rolling selections only after status and category filters take effect', async () => {
    api.getBuckets.mockResolvedValue([
      { id: 'pin-1', name: '钉选', content: '钉选正文', pinned: true },
      { id: 'recent-1', name: '最近', content: '最近正文', created: '2026-09-20', importance: 5 },
      { id: 'resolved-1', name: '已解决', content: '不应生效', resolved: true, importance: 9 },
      { id: 'feel-1', name: '感受', content: '感受正文', type: 'feel' },
      { id: 'high-1', name: '高重要度', content: '高重要度正文', importance: 8 },
      { id: 'noise-1', name: '噪音', content: '不应生效', noise: true, importance: 10 },
    ])
    api.getJournals.mockResolvedValue([
      { id: 'journal-1', name: '日记', content: '日记正文' },
      { id: 'locked-1', name: '锁定日记', content: '不应生效', locked: true },
    ])
    const selectedSession = {
      ...session,
      rolling_context: {
        ...session.rolling_context,
        selected_pinned_ids: ['pin-1'],
        selected_journal_ids: ['journal-1', 'locked-1'],
        selected_recent_ids: ['recent-1', 'resolved-1'],
        selected_feel_ids: ['feel-1'],
        selected_random_high_importance_ids: ['high-1', 'noise-1'],
      },
    } as HavenConversationSession
    const result = await loadRollingWindowAppend('window-1', selectedSession, [], { logDiagnostics: false })
    expect(result).toMatchObject({
      pinnedBucketIds: ['pin-1'],
      journalIds: ['journal-1'],
      recentBucketIds: ['recent-1'],
      feelBucketIds: ['feel-1'],
      randomHighImportanceBucketIds: ['high-1'],
    })
    expect(result.content).not.toContain('不应生效')
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

  it('uses the persisted native turn UUID after manual recovery instead of ambiguous text matching', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-native-uuid-'))
    const repeatedTurns = [
      {
        ...turns[0], id: 61, round_id: 61,
        user_text: '重复问题', assistant_text: '重复回答',
        raw_json: JSON.stringify({ cc_turn_uuid: 'native-turn-61' }),
      },
      {
        ...turns[0], id: 62, round_id: 62,
        user_text: '重复问题', assistant_text: '重复回答',
        raw_json: JSON.stringify({ cc_turn_uuid: 'native-turn-62' }),
      },
    ] as HavenTurn[]
    try {
      const source = createRollingHistorySeed([repeatedTurns[0]], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      for (const entry of source.entries) {
        delete entry.ob2HavenTurnId
        delete entry.ob2ChatDay
      }
      source.entries[0].uuid = 'native-turn-62'
      source.entries[0].timestamp = ''
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [{ type: 'custom-title', title: 'native uuid source' }],
      )

      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, repeatedTurns, [repeatedTurns[1]], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [repeatedTurns[1].chat_day],
        },
      )

      const messages = revised?.entries.filter(entry => entry.message) || []
      expect(messages).toHaveLength(2)
      expect(messages.every(entry => entry.ob2HavenTurnId === 62)).toBe(true)
      expect(messages.every(entry => entry.ob2ChatDay === repeatedTurns[1].chat_day)).toBe(true)
      expect(revised?.diagnostic?.bodyRestoredTurnCount).toBe(0)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('keeps a uniquely stamped turn even when its displayed assistant text differs from Haven', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-stamped-body-'))
    try {
      const source = createRollingHistorySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      const assistant = source.entries[1].message as { content: Array<{ type: string; text: string }> }
      assistant.content[0].text = '原生记录中的完整回答，与 Haven 展示正文不完全一样'
      await materializeRollingHistorySeed(source)
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, turns, turns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [turns[0].chat_day],
        },
      )
      expect(revised?.diagnostic?.retainedEnvelopeCount).toBe(1)
      expect(revised?.diagnostic?.bodyRestoredTurnCount).toBe(0)
      expect(JSON.stringify(revised?.entries)).toContain('原生记录中的完整回答')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('isolates an unpersisted user-only failed send after manual recovery', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-failed-send-'))
    const laterTurns = [
      {
        ...turns[0], id: 4, round_id: 4,
        raw_json: JSON.stringify({ cc_turn_uuid: 'successful-native-4' }),
      },
      {
        ...turns[0], id: 5, round_id: 5,
        raw_json: JSON.stringify({ cc_turn_uuid: 'successful-native-5' }),
      },
    ] as HavenTurn[]
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const nativeEntries = buildRollingTranscriptEntries(laterTurns, {
        sessionId: source.resumeFrom, cwd: 'C:/workspace', fallbackModel: 'claude',
      })
      for (let index = 0; index < laterTurns.length; index += 1) {
        const user = nativeEntries[index * 2]
        const assistant = nativeEntries[index * 2 + 1]
        user.uuid = `successful-native-${laterTurns[index].id}`
        assistant.parentUuid = user.uuid
        delete user.ob2HavenTurnId
        delete assistant.ob2HavenTurnId
      }
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [
          ...nativeEntries,
          {
            type: 'user', uuid: 'failed-send-uuid', parentUuid: nativeEntries.at(-1)?.uuid || null,
            sessionId: source.resumeFrom,
            message: { role: 'user', content: turns[0].user_text },
          },
        ],
      )
      const beforeInspection = await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [...turns, ...laterTurns], { storeRoot })
      expect(inspection).toMatchObject({
        available: true, aligned: true, envelopeCount: 4,
        matchedTurnCount: 3, isolatedIncompleteCount: 1,
      })
      expect(await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })).toEqual(beforeInspection)
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [...turns, ...laterTurns], [...turns, ...laterTurns], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [turns[0].chat_day],
        },
      )
      expect(revised?.diagnostic?.retainedEnvelopeCount).toBe(3)
      expect(revised?.diagnostic?.bodyRestoredTurnCount).toBe(0)
      expect(JSON.stringify(revised?.entries)).not.toContain('failed-send-uuid')
      expect(revised?.entries.filter(entry => entry.ob2HavenTurnId === 4)).toHaveLength(2)
      expect(revised?.entries.filter(entry => entry.ob2HavenTurnId === 5)).toHaveLength(2)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('does not discard an unmatched envelope with assistant output', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-unmatched-assistant-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [
          {
            type: 'user', uuid: 'unmatched-user', parentUuid: source.entries.at(-1)?.uuid || null,
            sessionId: source.resumeFrom,
            message: { role: 'user', content: '没有保存到 Haven 的输入' },
          },
          {
            type: 'assistant', uuid: 'unmatched-assistant', parentUuid: 'unmatched-user',
            sessionId: source.resumeFrom,
            message: { role: 'assistant', content: [{ type: 'text', text: '已有助手内容' }] },
          },
        ],
      )
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, turns, { storeRoot })
      expect(inspection.aligned).toBe(false)
      expect(inspection.issues).toMatchObject([{
        userUuid: 'unmatched-user', agentWake: false,
        reason: 'missing_haven_user', havenUserCandidateCount: 0,
      }])
      await expect(createRollingHistoryRevisionSeed(
        source.resumeFrom, turns, turns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [turns[0].chat_day],
        },
      )).rejects.toThrow('无正文候选 1 条')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('recovers a legacy foreground turn that lost Haven CAS to a simultaneous wake', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-wake-race-'))
    try {
      const retained = { ...turns[0], id: 3, round_id: 3 } as HavenTurn
      const source = createManualRollingBodyRecoverySeed([retained], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const racedEntries = [
        {
          type: 'user', uuid: 'wake-user', timestamp: '2026-09-18T11:35:00.000Z',
          message: { role: 'user', content: '<agent_wake cause="conversation_silence"/>' },
        },
        {
          type: 'assistant', uuid: 'wake-assistant', timestamp: '2026-09-18T11:35:20.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: '[agent_wake_noop] 她在回家路上，不打扰。' }] },
        },
        {
          type: 'user', uuid: 'race-user', timestamp: '2026-09-18T11:35:22.929Z',
          message: { role: 'user', content: '噗噗噗\n\n[北京时间 2026-09-18 19:35 周五]' },
        },
        {
          type: 'assistant', uuid: 'race-assistant', timestamp: '2026-09-18T11:35:24.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: '什么。' }] },
        },
      ].map(entry => ({ ...entry, sessionId: source.resumeFrom }))
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, racedEntries)

      const oldDuplicate = {
        ...retained, id: 4, round_id: 4, chat_day: '2026-09-17',
        user_text: '噗噗噗', assistant_text: '很早以前的不同回答',
        created_at: '2026-09-17T11:35:30.000Z', raw_json: '',
      } as HavenTurn
      const wakeTurn = {
        ...retained, id: 5, round_id: 5, chat_day: '2026-09-18',
        turn_kind: 'agent_wake', user_text: '', assistant_text: '',
        created_at: '2026-09-18T11:35:21.000Z', raw_json: '',
      } as HavenTurn
      const nearbyPersisted = {
        ...retained, id: 6, round_id: 6, chat_day: '2026-09-18',
        user_text: '噗噗噗', assistant_text: '并发后 Haven 中的不同回答',
        created_at: '2026-09-18T11:35:25.000Z', raw_json: '',
      } as HavenTurn
      const allTurns = [retained, oldDuplicate, wakeTurn, nearbyPersisted]
      const rawTurns = [retained, wakeTurn, nearbyPersisted]
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, allTurns, {
        storeRoot, rawTurns, requiredFullRawDays: rawTurns.map(turn => turn.chat_day),
      })
      expect(inspection).toMatchObject({
        aligned: true,
        matchedTurnCount: 3,
        recoveredAssistantMismatchCount: 1,
        issues: [],
      })

      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, allTurns, rawTurns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: rawTurns.map(turn => turn.chat_day),
        },
      )
      const recoveredEntries = revised?.entries.filter(entry => entry.ob2HavenTurnId === 6) || []
      expect(recoveredEntries).toHaveLength(2)
      expect(JSON.stringify(recoveredEntries.map(entry => entry.message))).toContain('什么。')
      expect(JSON.stringify(recoveredEntries.map(entry => entry.message))).not.toContain('并发后 Haven 中的不同回答')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('isolates a plain-text wake race turn that never reached Haven', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-wake-race-orphan-'))
    try {
      const retained = { ...turns[0], id: 3, round_id: 3 } as HavenTurn
      const wakeTurn = {
        ...retained, id: 5, round_id: 5, chat_day: '2026-09-18',
        turn_kind: 'agent_wake', user_text: '', assistant_text: '',
        created_at: '2026-09-18T11:35:21.000Z', raw_json: '',
      } as HavenTurn
      const oldDuplicate = {
        ...retained, id: 4, round_id: 4, chat_day: '2026-09-14',
        user_text: '噗噗噗', assistant_text: '旧回答',
        created_at: '2026-09-14T11:35:30.000Z', raw_json: '',
      } as HavenTurn
      const source = createManualRollingBodyRecoverySeed([retained], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const raceEntries = [
        {
          type: 'user', uuid: 'wake-user', timestamp: '2026-09-18T11:35:00.000Z',
          message: { role: 'user', content: '<agent_wake cause="conversation_silence"/>' },
        },
        {
          type: 'assistant', uuid: 'wake-assistant', timestamp: '2026-09-18T11:35:20.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: '[agent_wake_noop] 不打扰。' }] },
        },
        {
          type: 'user', uuid: 'orphan-user', timestamp: '2026-09-18T11:35:22.929Z',
          message: { role: 'user', content: '噗噗噗\n\n[北京时间 2026-09-18 19:35 周五]' },
        },
        {
          type: 'assistant', uuid: 'orphan-assistant', timestamp: '2026-09-18T11:35:24.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: '什么。' }] },
        },
      ].map(entry => ({ ...entry, sessionId: source.resumeFrom }))
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, raceEntries)
      const originalEntries = await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })
      const allTurns = [retained, oldDuplicate, wakeTurn]
      const rawTurns = [retained, wakeTurn]

      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, allTurns, {
        storeRoot, rawTurns, requiredFullRawDays: rawTurns.map(turn => turn.chat_day),
      })
      expect(inspection).toMatchObject({
        aligned: true,
        matchedTurnCount: 2,
        isolatedIncompleteCount: 0,
        isolatedWakeRaceCount: 1,
        issues: [],
      })
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, allTurns, rawTurns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: rawTurns.map(turn => turn.chat_day),
        },
      )
      expect(JSON.stringify(revised?.entries.map(entry => entry.message))).not.toContain('噗噗噗')
      expect(JSON.stringify(revised?.entries.map(entry => entry.message))).not.toContain('什么。')
      expect(JSON.stringify(revised?.entries.map(entry => entry.message))).toContain('agent_wake')
      expect(await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })).toEqual(originalEntries)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('does not isolate an unmatched post-wake turn containing a tool call', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-wake-race-tool-'))
    try {
      const retained = { ...turns[0], id: 3, round_id: 3 } as HavenTurn
      const wakeTurn = {
        ...retained, id: 4, round_id: 4, chat_day: '2026-09-18',
        turn_kind: 'agent_wake', user_text: '', assistant_text: '', raw_json: '',
      } as HavenTurn
      const source = createManualRollingBodyRecoverySeed([retained], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [
        { type: 'user', uuid: 'wake-user', timestamp: '2026-09-18T11:35:00.000Z', sessionId: source.resumeFrom, message: { role: 'user', content: '<agent_wake cause="conversation_silence"/>' } },
        { type: 'assistant', uuid: 'wake-answer', timestamp: '2026-09-18T11:35:10.000Z', sessionId: source.resumeFrom, message: { role: 'assistant', content: [{ type: 'text', text: '[agent_wake_noop] 不打扰。' }] } },
        { type: 'user', uuid: 'tool-user', timestamp: '2026-09-18T11:35:12.000Z', sessionId: source.resumeFrom, message: { role: 'user', content: '执行操作' } },
        { type: 'assistant', uuid: 'tool-answer', timestamp: '2026-09-18T11:35:13.000Z', sessionId: source.resumeFrom, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'important_tool', input: {} }] } },
      ])
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [retained, wakeTurn], { storeRoot })
      expect(inspection.aligned).toBe(false)
      expect(inspection.isolatedWakeRaceCount).toBe(0)
      expect(inspection.issues).toMatchObject([{ userUuid: 'tool-user' }])
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('identifies a wake transcript with a mismatched Haven assistant body without exposing either body', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-wake-audit-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      await source.sessionStore.append(
        { projectKey: '', sessionId: source.resumeFrom },
        [
          {
            type: 'user', uuid: 'wake-user', parentUuid: source.entries.at(-1)?.uuid || null,
            sessionId: source.resumeFrom,
            message: { role: 'user', content: '<agent_wake cause="agent_schedule"/>' },
          },
          {
            type: 'assistant', uuid: 'wake-assistant', parentUuid: 'wake-user',
            sessionId: source.resumeFrom,
            message: { role: 'assistant', content: [{ type: 'text', text: 'transcript 里的回答' }] },
          },
        ],
      )
      const wakeTurn = {
        ...turns[0], id: 4, round_id: 4, turn_kind: 'agent_wake',
        user_text: '', assistant_text: 'Haven 里的不同回答', raw_json: '',
      } as HavenTurn
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [...turns, wakeTurn], { storeRoot })
      expect(inspection.aligned).toBe(false)
      expect(inspection.issues).toMatchObject([{
        userUuid: 'wake-user', agentWake: true,
        reason: 'assistant_mismatch', havenUserCandidateCount: 1,
        havenUserCandidateIds: [4],
      }])
      expect(JSON.stringify(inspection.issues)).not.toContain('transcript 里的回答')
      expect(JSON.stringify(inspection.issues)).not.toContain('Haven 里的不同回答')
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('keeps SDK no-visible-output continuation inside its wake turn without rewriting transcript entries', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-wake-continuation-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const wakeEntries = [
        { type: 'user', uuid: 'wake-trigger', message: { role: 'user', content: '<agent_wake cause="agent_schedule"/>' } },
        { type: 'assistant', uuid: 'wake-tool', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'wake-tool-id', name: 'set_agent_wake', input: {} }] } },
        { type: 'user', uuid: 'wake-tool-result', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'wake-tool-id', content: '已安排' }] } },
        { type: 'user', uuid: 'sdk-no-visible', message: { role: 'user', content: '[Your previous response had no visible output. Please continue and produce a user-visible response.]' } },
        { type: 'assistant', uuid: 'wake-noop', message: { role: 'assistant', content: [{ type: 'text', text: '[agent_wake_noop]设置完毕' }] } },
      ].map(entry => ({ ...entry, sessionId: source.resumeFrom }))
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, wakeEntries)
      const wakeTurn = {
        ...turns[0], id: 4, round_id: 4, turn_kind: 'agent_wake',
        user_text: '', assistant_text: '', raw_json: '',
      } as HavenTurn
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [...turns, wakeTurn], { storeRoot })
      expect(inspection).toMatchObject({ aligned: true, matchedTurnCount: 2, issues: [] })
      const originalEntries = await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [...turns, wakeTurn], [...turns, wakeTurn], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [turns[0].chat_day],
        },
      )
      expect(revised?.entries.map(entry => entry.message)).toEqual([...source.entries, ...wakeEntries].map(entry => entry.message))
      expect(await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })).toEqual(originalEntries)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('keeps interruption and auto-continue messages inside the original user turn', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-interrupted-continuation-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const continuedEntries = [
        { type: 'user', uuid: 'real-user', message: { role: 'user', content: '我的真实消息' } },
        { type: 'assistant', uuid: 'real-answer', message: { role: 'assistant', content: [{ type: 'text', text: '原本答复' }] } },
        { type: 'user', uuid: 'interrupted-marker', message: { role: 'user', content: '[Request interrupted by user]' } },
        { type: 'user', uuid: 'auto-continue', message: { role: 'user', content: 'Continue from where you left off.' } },
        { type: 'assistant', uuid: 'no-response', message: { role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] } },
      ].map(entry => ({ ...entry, sessionId: source.resumeFrom }))
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, continuedEntries)
      const actualTurn = {
        ...turns[0], id: 4, round_id: 4,
        user_text: '我的真实消息', assistant_text: '原本答复', raw_json: '',
      } as HavenTurn
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [...turns, actualTurn], { storeRoot })
      expect(inspection).toMatchObject({ aligned: true, matchedTurnCount: 2, issues: [] })
      const originalEntries = await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [...turns, actualTurn], [...turns, actualTurn], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [turns[0].chat_day],
        },
      )
      expect(revised?.entries.map(entry => entry.message)).toEqual([...source.entries, ...continuedEntries].map(entry => entry.message))
      expect(await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })).toEqual(originalEntries)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('isolates only a status-only failed request while retaining its successful resend', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-failed-status-retry-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const laterEntries = [
        { type: 'user', uuid: 'failed-real-user', message: { role: 'user', content: '这条后来重新发送' } },
        { type: 'user', uuid: 'failed-interrupted', message: { role: 'user', content: '[Request interrupted by user]' } },
        { type: 'user', uuid: 'failed-continue', message: { role: 'user', content: 'Continue from where you left off.' } },
        { type: 'assistant', uuid: 'failed-status', message: { role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] } },
        { type: 'user', uuid: 'successful-retry', message: { role: 'user', content: '这条后来重新发送' } },
        { type: 'assistant', uuid: 'successful-answer', message: { role: 'assistant', content: [{ type: 'text', text: '重新发送后成功回答' }] } },
      ].map(entry => ({ ...entry, sessionId: source.resumeFrom }))
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, laterEntries)
      const successfulTurn = {
        ...turns[0], id: 4, round_id: 4,
        user_text: '这条后来重新发送', assistant_text: '重新发送后成功回答',
        raw_json: JSON.stringify({ cc_turn_uuid: 'successful-retry' }),
      } as HavenTurn
      const originalEntries = await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [...turns, successfulTurn], { storeRoot })
      expect(inspection).toMatchObject({
        aligned: true, envelopeCount: 3, matchedTurnCount: 2,
        isolatedIncompleteCount: 1, issues: [],
      })
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, [...turns, successfulTurn], [...turns, successfulTurn], {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: [turns[0].chat_day],
        },
      )
      expect(revised?.entries.map(entry => entry.message)).toEqual([
        ...source.entries, ...laterEntries.slice(4),
      ].map(entry => entry.message))
      expect(await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })).toEqual(originalEntries)
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('does not isolate an interrupted request containing a real assistant reply or tool call', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-interrupted-with-output-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [
        { type: 'user', uuid: 'real-user-with-output', sessionId: source.resumeFrom, message: { role: 'user', content: '失败前做了工具调用' } },
        { type: 'assistant', uuid: 'tool-before-failure', sessionId: source.resumeFrom, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-before-failure', name: 'search', input: {} }] } },
        { type: 'user', uuid: 'interrupted-after-tool', sessionId: source.resumeFrom, message: { role: 'user', content: '[Request interrupted by user]' } },
        { type: 'user', uuid: 'continue-after-tool', sessionId: source.resumeFrom, message: { role: 'user', content: 'Continue from where you left off.' } },
        { type: 'assistant', uuid: 'status-after-tool', sessionId: source.resumeFrom, message: { role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] } },
      ])
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, turns, { storeRoot })
      expect(inspection.aligned).toBe(false)
      expect(inspection.issues).toMatchObject([{ userUuid: 'real-user-with-output' }])
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })

  it('does not isolate an interrupted request containing an image or thinking block', async () => {
    for (const variant of ['image', 'thinking'] as const) {
      const storeRoot = await mkdtemp(path.join(tmpdir(), `ob2-rolling-interrupted-${variant}-`))
      try {
        const source = createManualRollingBodyRecoverySeed(turns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
        })!
        await materializeRollingHistorySeed(source)
        await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [
          {
            type: 'user', uuid: `real-user-${variant}`, sessionId: source.resumeFrom,
            message: { role: 'user', content: variant === 'image'
              ? [{ type: 'text', text: '含图片的失败输入' }, { type: 'image', source: { type: 'base64', data: 'image-data' } }]
              : '含 thinking 的失败输入' },
          },
          { type: 'user', uuid: `interrupted-${variant}`, sessionId: source.resumeFrom, message: { role: 'user', content: '[Request interrupted by user]' } },
          { type: 'user', uuid: `continue-${variant}`, sessionId: source.resumeFrom, message: { role: 'user', content: 'Continue from where you left off.' } },
          {
            type: 'assistant', uuid: `status-${variant}`, sessionId: source.resumeFrom,
            message: { role: 'assistant', content: variant === 'thinking'
              ? [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'No response requested.' }]
              : [{ type: 'text', text: 'No response requested.' }] },
          },
        ])
        const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, turns, { storeRoot })
        expect(inspection.aligned).toBe(false)
        expect(inspection.issues).toMatchObject([{ userUuid: `real-user-${variant}` }])
      } finally {
        await rm(storeRoot, { recursive: true, force: true })
      }
    }
  })

  it('does not silently absorb a standalone auto-continue message', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-unanchored-continuation-'))
    try {
      const source = createManualRollingBodyRecoverySeed(turns, {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      await source.sessionStore.append({ projectKey: '', sessionId: source.resumeFrom }, [
        { type: 'user', uuid: 'unanchored-continue', sessionId: source.resumeFrom, message: { role: 'user', content: 'Continue from where you left off.' } },
        { type: 'assistant', uuid: 'unanchored-answer', sessionId: source.resumeFrom, message: { role: 'assistant', content: [{ type: 'text', text: '没有锚点' }] } },
      ])
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, turns, { storeRoot })
      expect(inspection.aligned).toBe(false)
      expect(inspection.issues).toMatchObject([{ userUuid: 'unanchored-continue' }])
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
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, [retained, missing], {
        storeRoot, rawTurns: [retained, missing], requiredFullRawDays: [retained.chat_day, missing.chat_day],
      })
      expect(inspection).toMatchObject({ aligned: true, matchedTurnCount: 1 })
      expect(inspection.missingRawTurns).toEqual([{
        id: 2, day: '2026-09-12', createdAt: missing.created_at,
        turnKind: 'user', userChars: missing.user_text.length,
        assistantChars: missing.assistant_text.length, fullSourceRequired: true,
      }])
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

  it('keeps an unrepresented empty wake in Haven without blocking a raw-day revision', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-rolling-empty-wake-'))
    const retained = { ...turns[0], id: 1, round_id: 1, chat_day: '2026-09-13' } as HavenTurn
    const emptyWake = {
      ...turns[0], id: 2, round_id: 2, chat_day: '2026-09-13',
      turn_kind: 'agent_wake', user_text: '', assistant_text: '',
      raw_json: JSON.stringify({ agent_wake: { cause: 'agent_schedule' }, process: [{ type: 'thinking', text: 'stored in Haven' }] }),
    } as HavenTurn
    try {
      const source = createRollingHistorySeed([retained], {
        cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
      })!
      await materializeRollingHistorySeed(source)
      const rawTurns = [retained, emptyWake]
      const inspection = await inspectRollingHistoryAlignment(source.resumeFrom, rawTurns, {
        storeRoot, rawTurns, requiredFullRawDays: ['2026-09-13'],
      })
      expect(inspection).toMatchObject({
        aligned: true, missingRawTurns: [], unrepresentedEmptyWakeCount: 1,
      })
      const revised = await createRollingHistoryRevisionSeed(
        source.resumeFrom, rawTurns, rawTurns, {
          cwd: 'C:/workspace', fallbackModel: 'claude', storeRoot,
          requiredFullRawDays: ['2026-09-13'],
        },
      )
      expect(revised?.entries.map(entry => entry.message)).toEqual(source.entries.map(entry => entry.message))
      expect(revised?.diagnostic.bodyRestoredTurnCount).toBe(0)
      expect(emptyWake.raw_json).toContain('stored in Haven')
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
