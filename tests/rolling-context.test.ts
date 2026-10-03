import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSessionMessages, type SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
const api = vi.hoisted(() => ({ getBuckets: vi.fn(), getJournals: vi.fn(), initializeSnapshot: vi.fn() }))

vi.mock('@/app/lib/havenTurns', async importOriginal => ({
  ...await importOriginal<typeof import('@/app/lib/havenTurns')>(),
  initializeRollingPinnedSnapshot: api.initializeSnapshot,
}))

vi.mock('@/app/lib/api', () => ({
  getBuckets: api.getBuckets,
  getJournals: api.getJournals,
}))

import { buildRollingWindowAppend, buildRollingWindowHistory, loadRollingWindowAppend, selectRollingPinnedSnapshot } from '@/app/lib/cc/windowPrompt'
import {
  cloneRollingTranscriptForSession,
  inspectRollingHistoryTranscript, materializeRollingHistorySeed, materializeRollingNativeSession,
  nativeClaudeSessionFile, openRollingHistoryResume, RollingSeedStore, stripStaleSystemReminders,
} from '@/app/lib/cc/rollingHistory'
import {
  appendRollingArchive, archiveChatDay, archiveEnvelopes, createArchiveRevisionSeed,
  createManualRollingArchiveRecoverySeed, ensureRollingArchive, inspectRollingArchive,
  readRollingArchive, sliceRollingArchive, syncRollingNativeSession,
} from '@/app/lib/cc/rollingArchive'
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

describe('model surface transcript rebase', () => {
  it('removes stale SDK system reminders without losing conversation or tool history', () => {
    const source = [
      {
        type: 'system', subtype: 'init', uuid: 'init', parentUuid: null,
        instructions: '旧 MCP server instructions',
      },
      {
        type: 'user', uuid: 'meta', parentUuid: 'init',
        message: { role: 'user', content: '<system-reminder>旧 MCP instructions</system-reminder>' },
      },
      {
        type: 'user', uuid: 'user', parentUuid: 'meta',
        message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>旧工具 schema</system-reminder>\n真实问题' }] },
      },
      {
        type: 'assistant', uuid: 'tool', parentUuid: 'user',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'search', input: {} }] },
      },
      {
        type: 'user', uuid: 'result', parentUuid: 'tool',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '结果' }] },
      },
      {
        type: 'assistant', uuid: 'answer', parentUuid: 'result',
        message: { role: 'assistant', content: [{ type: 'text', text: '最终回答' }] },
      },
    ] as SessionStoreEntry[]

    const cleaned = stripStaleSystemReminders(source)
    expect(cleaned.removedBlockCount).toBe(3)
    expect(cleaned.entries).toHaveLength(4)
    expect(JSON.stringify(cleaned.entries)).not.toContain('system-reminder')
    expect(JSON.stringify(cleaned.entries)).not.toContain('旧 MCP server instructions')
    expect(JSON.stringify(cleaned.entries)).toContain('真实问题')
    expect(JSON.stringify(cleaned.entries)).toContain('tool_use')
    expect(JSON.stringify(cleaned.entries)).toContain('tool_result')
    expect(JSON.stringify(cleaned.entries)).toContain('最终回答')
    expect(JSON.stringify(source)).toContain('旧 MCP instructions')
  })
})

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
    api.initializeSnapshot.mockImplementation(async ({ snapshot }) => snapshot)
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

  it('keeps pinned text, order and exclusions frozen across edits, unpins and deletions', async () => {
    const frozen = [{ id: 'pin-1', title: '旧标题', content: '旧正文' }]
    const frozenSession = {
      ...session,
      rolling_context: { ...session.rolling_context, pinned_snapshot: frozen, selected_recent_ids: ['pin-1'] },
    } as HavenConversationSession
    api.initializeSnapshot.mockClear()
    api.getBuckets.mockResolvedValue([{ id: 'pin-1', name: '新标题', content: '新正文', pinned: false }])
    const first = await loadRollingWindowAppend('window-1', frozenSession, [], { logDiagnostics: false })
    api.getBuckets.mockResolvedValue([{ id: 'new-pin', content: '新增钉选', pinned: true }])
    const second = await loadRollingWindowAppend('window-1', frozenSession, [], { logDiagnostics: false })
    expect(second.content).toBe(first.content)
    expect(second.content).toContain('旧正文')
    expect(second.content).not.toContain('新正文')
    expect(second.pinnedBucketIds).toEqual(['pin-1'])
    expect(first.recentBucketIds).toEqual([])
    expect(api.initializeSnapshot).not.toHaveBeenCalled()
  })

  it('treats an empty snapshot as frozen, and applies new pinned text at a rebuilt revision', async () => {
    api.getBuckets.mockResolvedValue([{ id: 'pin-1', name: '新标题', content: '新正文', pinned: true }])
    api.initializeSnapshot.mockClear()
    const empty = { ...session, rolling_context: { ...session.rolling_context, pinned_snapshot: [] } } as HavenConversationSession
    expect((await loadRollingWindowAppend('window-1', empty, [], { logDiagnostics: false })).pinnedBucketIds).toEqual([])
    expect(api.initializeSnapshot).not.toHaveBeenCalled()
    const rebuilt = {
      ...empty, context_revision: 8,
      rolling_context: { ...empty.rolling_context, pinned_snapshot: selectRollingPinnedSnapshot(await api.getBuckets(), ['pin-1']) },
    } as HavenConversationSession
    expect((await loadRollingWindowAppend('window-1', rebuilt, [], { logDiagnostics: false })).content).toContain('新正文')
  })

  it('uses the winning persisted legacy snapshot and stops if persistence fails', async () => {
    api.getBuckets.mockResolvedValue([{ id: 'pin-1', content: '本轮新正文', pinned: true }])
    api.initializeSnapshot.mockResolvedValueOnce([{ id: 'pin-1', title: '标题', content: '已冻结正文' }])
    const result = await loadRollingWindowAppend('window-1', session, [], { logDiagnostics: false })
    expect(result.content).toContain('已冻结正文')
    expect(result.content).not.toContain('本轮新正文')
    api.initializeSnapshot.mockRejectedValueOnce(new Error('context_revision_conflict'))
    await expect(loadRollingWindowAppend('window-1', session, [], { logDiagnostics: false })).rejects.toThrow('context_revision_conflict')
  })

  it('previews legacy pinned content in an audit without persisting it', async () => {
    api.getBuckets.mockResolvedValue([{ id: 'pin-1', content: '待冻结正文', pinned: true }])
    api.initializeSnapshot.mockClear()
    const result = await loadRollingWindowAppend('window-1', session, [], { logDiagnostics: false, persistPinnedSnapshot: false })
    expect(result.content).toContain('待冻结正文')
    expect(api.initializeSnapshot).not.toHaveBeenCalled()
  })

})

const context = { timezone: 'Asia/Shanghai', day_start_hour: 4, day_modes: {} }
const key = { havenSessionId: 'synthetic-window', laneId: 'subscription' }
const seedOptions = { cwd: '/synthetic', fallbackModel: 'synthetic-model' }

function entry(uuid: string, role: string, timestamp: string, content: unknown): SessionStoreEntry {
  return { type: role, uuid, parentUuid: null, timestamp, sessionId: 'synthetic-native',
    message: { role, content } } as SessionStoreEntry
}
function nativeRound(id: string, timestamp: string): SessionStoreEntry[] {
  return [
    entry(`${id}-u`, 'user', timestamp, [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'c3ludGhldGlj' } },
      { type: 'text', text: `<记忆召回>recall-${id}</记忆召回>\nquestion-${id}` },
    ]),
    entry(`${id}-a`, 'assistant', timestamp, [
      { type: 'thinking', thinking: `thinking-${id}`, signature: 'synthetic-signature' },
      { type: 'redacted_thinking', data: 'synthetic' },
      { type: 'tool_use', id: `tool-${id}`, name: 'synthetic_tool', input: { query: id } },
    ]),
    entry(`${id}-r`, 'user', timestamp, [{ type: 'tool_result', tool_use_id: `tool-${id}`, content: `result-${id}` }]),
    entry(`${id}-end`, 'assistant', timestamp, [{ type: 'text', text: `answer-${id}` }]),
    { type: 'attachment', parentUuid: null, uuid: `${id}-env`, timestamp, attachment: { type: 'environment', content: 'old environment' } },
    { type: 'attachment', parentUuid: null, uuid: `${id}-file`, timestamp, attachment: { type: 'file', content: 'keep file' } },
  ] as SessionStoreEntry[]
}
async function withStore(test: (storeRoot: string, claudeConfigDir: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'ob2-archive-synthetic-'))
  try { await test(path.join(root, 'store'), path.join(root, 'claude')) }
  finally { await rm(root, { recursive: true, force: true }) }
}

describe('native archive day slicing', () => {
  it('keeps compaction artifacts in the archive but removes boundaries and summaries from revisions, preserving both sides', async () => withStore(async storeRoot => {
    const source = [
      ...nativeRound('before', '2026-09-12T08:00:00Z'),
      { type: 'system', subtype: 'compact_boundary', uuid: 'compact-boundary', timestamp: '2026-09-12T09:00:00Z' },
      { ...entry('compact-summary', 'user', '2026-09-12T09:00:01Z', 'synthetic compact summary'), isCompactSummary: true },
      ...nativeRound('after', '2026-09-12T10:00:00Z'),
    ] as SessionStoreEntry[]
    await appendRollingArchive(key, source, { storeRoot })
    const archive = (await readRollingArchive(key, { storeRoot }))!
    expect(archive.map(item => item.uuid)).toEqual(source.map(item => item.uuid))
    const seed = createArchiveRevisionSeed(archive, context, [], { ...seedOptions, storeRoot })!
    expect(seed.entries.some(item => item.type === 'system' && item.subtype === 'compact_boundary')).toBe(false)
    expect(seed.entries.some(item => item.type === 'user' && item.isCompactSummary === true)).toBe(false)
    const text = JSON.stringify(seed.entries)
    for (const side of ['before', 'after']) {
      expect(text).toContain(`question-${side}`)
      expect(text).toContain(`answer-${side}`)
      expect(text).toContain(`tool-${side}`)
      expect(text).toContain(`result-${side}`)
    }
    expect(archiveEnvelopes(archive, context)).toHaveLength(2)
    expect(await readRollingArchive(key, { storeRoot })).toEqual(archive)
  }))

  it('uses local wall time and the 03:59 / 04:00 boundary, including timezone defaults', () => {
    expect(archiveChatDay('2026-09-11T19:59:00Z', context)).toBe('2026-09-11')
    expect(archiveChatDay('2026-09-11T20:00:00Z', context)).toBe('2026-09-12')
    expect(archiveChatDay('2026-09-11T23:59:00Z', { ...context, timezone: 'UTC', day_start_hour: 0 })).toBe('2026-09-11')
    expect(archiveChatDay('2026-09-11T20:00:00Z', { ...context, timezone: '' })).toBe('2026-09-12')
  })

  it('groups images, SDK continuations, interrupted halves, wake and midnight replies without Haven', () => {
    const source = [
      { type: 'system', uuid: 'prefix' },
      ...nativeRound('image', '2026-09-11T15:59:00Z'),
      entry('interrupt', 'user', '2026-09-11T16:00:00Z', '[Request interrupted by user]'),
      entry('continue', 'user', '2026-09-11T16:01:00Z', 'Continue from where you left off.'),
      entry('late-answer', 'assistant', '2026-09-11T20:00:00Z', [{ type: 'text', text: 'reply beyond day boundary' }]),
      entry('cutoff', 'user', '2026-09-11T20:01:00Z', 'Your response above was cut off. Please continue.'),
      entry('cutoff-answer', 'assistant', '2026-09-11T20:02:00Z', [{ type: 'text', text: 'continued answer' }]),
      entry('wake', 'user', '2026-09-12T10:00:00Z', '<agent_wake/>'),
      entry('wake-answer', 'assistant', '2026-09-12T10:01:00Z', [{ type: 'text', text: 'wake answer' }]),
      entry('sdk-continue', 'user', '2026-09-12T10:02:00Z', '[Your previous response had no visible output. Please continue and produce a user-visible response.]'),
      entry('half', 'user', '2026-09-13T10:00:00Z', 'unfinished question'),
    ] as SessionStoreEntry[]
    const groups = archiveEnvelopes(source, context)
    expect(groups.map(group => group.day)).toEqual(['2026-09-11', '2026-09-12', '2026-09-13'])
    expect(groups[0].entries.map(item => item.uuid)).toContain('late-answer')
    expect(groups[0].entries.map(item => item.uuid)).toContain('cutoff-answer')
    const sliced = sliceRollingArchive(source, { ...context, day_modes: { '2026-09-12': 'review', '2026-09-13': 'omit' } }, [], seedOptions)
    expect(sliced.entries.map(item => item.uuid)).not.toContain('prefix')
    expect(sliced.entries.map(item => item.uuid)).not.toContain('half')
    expect(sliced.entries.map(item => item.uuid)).not.toContain('wake')
    expect(JSON.stringify(sliced.entries)).toContain('image/png')
    expect(JSON.stringify(sliced.entries)).toContain('continued answer')
  })

  it('keeps latest-day thinking/recall; prunes older completed thinking, recall and SDK attachments only', () => {
    const source = [...nativeRound('old', '2026-09-11T10:00:00Z'), ...nativeRound('latest', '2026-09-12T10:00:00Z')]
    const before = JSON.stringify(source)
    const sliced = sliceRollingArchive(source, context, [], seedOptions)
    const text = JSON.stringify(sliced.entries)
    expect(text).not.toContain('thinking-old')
    expect(text).not.toContain('recall-old')
    expect(text).not.toContain('old-env')
    expect(text).toContain('old-file')
    expect(text).toContain('thinking-latest')
    expect(text).toContain('recall-latest')
    expect(text).toContain('latest-env')
    for (const id of ['old', 'latest']) {
      expect(text).toContain(`question-${id}`)
      expect(text).toContain(`answer-${id}`)
      expect(text).toContain(`tool-${id}`)
      expect(text).toContain(`result-${id}`)
    }
    expect(sliced.days[0]).toMatchObject({ thinkingPrunedBlockCount: 2, memoryRecallPrunedBlockCount: 1, attachmentPrunedBlockCount: 1 })
    expect(JSON.stringify(source)).toBe(before)
  })

  it('protects thinking when an older tool_use has no result', () => {
    const incomplete = nativeRound('open', '2026-09-11T10:00:00Z').filter(item => item.uuid !== 'open-r')
    const sliced = sliceRollingArchive([...incomplete, ...nativeRound('latest', '2026-09-12T10:00:00Z')], context, [], seedOptions)
    expect(JSON.stringify(sliced.entries)).toContain('thinking-open')
    expect(sliced.days[0].thinkingPrunedBlockCount).toBe(0)
  })

  it('uses the archive latest day, even when that day is omitted', () => {
    const source = [...nativeRound('old', '2026-09-11T10:00:00Z'), ...nativeRound('latest', '2026-09-12T10:00:00Z')]
    const sliced = sliceRollingArchive(source, { ...context, day_modes: { '2026-09-12': 'omit' } }, [], seedOptions)
    expect(JSON.stringify(sliced.entries)).not.toContain('thinking-')
    expect(sliced.days.map(day => day.treatment)).toEqual(['pruned', 'removed'])
  })

  it('restores omit → raw from an immutable archive; only an entirely absent date uses Haven body', async () => withStore(async storeRoot => {
    const source = [...nativeRound('old', '2026-09-11T10:00:00Z'), ...nativeRound('latest', '2026-09-12T10:00:00Z')]
    await appendRollingArchive(key, source, { storeRoot })
    const archive = (await readRollingArchive(key, { storeRoot }))!
    const omitted = createArchiveRevisionSeed(archive, { ...context, day_modes: { '2026-09-11': 'omit' } }, [], { ...seedOptions, storeRoot })!
    expect(JSON.stringify(omitted.entries)).not.toContain('tool-old')
    const restored = createArchiveRevisionSeed(archive, context, [
      { ...turns[0], chat_day: '2026-09-11', user_text: 'Haven must not fill a partial day' },
      { ...turns[0], id: 4, chat_day: '2026-09-10', created_at: '2026-09-10T10:00:00Z', user_text: 'missing date body' },
    ], { ...seedOptions, storeRoot })!
    const text = JSON.stringify(restored.entries)
    expect(text).toContain('tool-old')
    expect(text).toContain('result-old')
    expect(text).toContain('image/png')
    expect(text).not.toContain('Haven must not fill')
    expect(text).toContain('missing date body')
    expect(restored.entries.filter(item => item.ob2RollingFidelity === 'body_restored')).toHaveLength(2)
    expect(restored.diagnostic?.days?.find(day => day.day === '2026-09-10')?.treatment).toBe('body_restored')
    expect(await readRollingArchive(key, { storeRoot })).toEqual(archive)
  }))

  it('preserves archive identities when UUIDs and parent chains are cloned', () => {
    const source = nativeRound('old', '2026-09-11T10:00:00Z').map(item => ({ ...item, ob2ArchiveUuid: item.uuid }))
    const cloned = cloneRollingTranscriptForSession(source, 'new-native')
    expect(cloned.map(item => item.ob2ArchiveUuid)).toEqual(source.map(item => item.uuid))
    expect(cloned.map(item => item.uuid)).not.toEqual(source.map(item => item.uuid))
    expect(cloned[0].parentUuid).toBe(null)
    expect(cloned[1].parentUuid).toBe(cloned[0].uuid)
  })
})

describe('archive IO and migration', () => {
  it('leaves fixed native transcript and legacy RollingSeedStore source files byte-identical after migration', async () => withStore(async (storeRoot, claudeConfigDir) => {
    const source = nativeRound('source', '2026-09-12T10:00:00Z')
    const fixedFile = await nativeClaudeSessionFile('fixed-source', seedOptions.cwd, claudeConfigDir)
    await mkdir(path.dirname(fixedFile), { recursive: true })
    // Extra whitespace proves migration preserves the actual source bytes, not just its messages.
    await writeFile(fixedFile, source.map(item => ` ${JSON.stringify(item)} `).join('\r\n') + '\r\n', 'utf8')
    const fixedBefore = await readFile(fixedFile)
    const fixedArchive = await ensureRollingArchive(key, { storeRoot, claudeConfigDir, cwd: seedOptions.cwd,
      sourceResumeFrom: 'fixed-source', fixedMigration: true,
      importLocalSession: async (_id, store) => {
        const entries = (await readFile(fixedFile, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
        await store.append({ projectKey: '', sessionId: 'fixed-source' }, entries)
      } })
    expect(await readFile(fixedFile)).toEqual(fixedBefore)
    expect(openRollingHistoryResume('fixed-source', { storeRoot })).toBeNull()
    expect(fixedArchive.every(item => item.ob2ArchiveUuid === item.uuid)).toBe(true)

    const legacyStore = new RollingSeedStore('legacy-source', source, storeRoot)
    await legacyStore.materialize('legacy-source')
    const legacyFile = path.join(storeRoot, Buffer.from('legacy-source').toString('base64url'), 'main.jsonl')
    const legacyBefore = await readFile(legacyFile)
    const legacyKey = { ...key, laneId: 'api:read-only-source' }
    const legacyArchive = await ensureRollingArchive(legacyKey, { storeRoot, claudeConfigDir,
      cwd: seedOptions.cwd, sourceResumeFrom: 'legacy-source' })
    expect(await readFile(legacyFile)).toEqual(legacyBefore)
    expect(legacyArchive.every(item => item.ob2ArchiveUuid === item.uuid)).toBe(true)
    expect(await legacyStore.load({ projectKey: '', sessionId: 'legacy-source' })).toEqual(source)
    // Reusing the unmarked source still deduplicates by its native UUID.
    await appendRollingArchive(legacyKey, source, { storeRoot })
    expect(await readRollingArchive(legacyKey, { storeRoot })).toHaveLength(source.length)
  }))

  it('excludes UUID-less metadata from archives/revisions and repeated sync does not duplicate visible entries', async () => withStore(async (storeRoot, claudeConfigDir) => {
    const visible = nativeRound('visible', '2026-09-12T10:00:00Z')
    const metadata = ['queue-operation', 'file-history-snapshot', 'ai-title', 'last-prompt', 'mode', 'atis-latch', 'cost-state']
      .map(type => ({ type, value: 'synthetic metadata' })) as SessionStoreEntry[]
    const incoming = [...metadata.slice(0, 2), ...visible, ...metadata.slice(2)]
    const options = { ...key, storeRoot, claudeConfigDir,
      importLocalSession: async (_id: string, store: import('@anthropic-ai/claude-agent-sdk').SessionStore) => {
        await store.append({ projectKey: '', sessionId: 'metadata-native' }, incoming)
      } }
    await syncRollingNativeSession('metadata-native', seedOptions.cwd, options)
    await syncRollingNativeSession('metadata-native', seedOptions.cwd, options)
    const archive = (await readRollingArchive(key, { storeRoot }))!
    expect(archive.map(item => item.uuid)).toEqual(visible.map(item => item.uuid))
    const revision = createArchiveRevisionSeed([...metadata, ...archive], context, [], { ...seedOptions, storeRoot })!
    expect(revision.entries).toHaveLength(visible.length)
    expect(revision.entries.every(item => item.uuid && item.ob2ArchiveUuid)).toBe(true)
    const current = await openRollingHistoryResume('metadata-native', { storeRoot })!.sessionStore.load({ projectKey: '', sessionId: 'metadata-native' })
    expect(current!.filter(item => !item.uuid)).toEqual(metadata)
  }))

  it.each(['user', 'assistant', 'attachment'])('stops for a model-visible %s entry without UUID rather than adding an ID', async type => withStore(async storeRoot => {
    const invalid = [{ type, timestamp: '2026-09-12T10:00:00Z', message: { role: type, content: 'synthetic' } }] as SessionStoreEntry[]
    await expect(appendRollingArchive(key, invalid, { storeRoot })).rejects.toThrow('缺少 uuid')
    expect(() => createArchiveRevisionSeed(invalid, context, [], { ...seedOptions, storeRoot })).toThrow('缺少 uuid')
    expect(await readRollingArchive(key, { storeRoot })).toBeNull()
    expect(invalid[0].uuid).toBeUndefined()
  }))

  it('initializes fixed history by official import and legacy rolling history by durable seed', async () => withStore(async (storeRoot, claudeConfigDir) => {
    const source = nativeRound('native', '2026-09-12T10:00:00Z')
    const importLocalSession = vi.fn(async (_id, store) => { await store.append({ projectKey: '', sessionId: 'fixed' }, source) })
    const archive = await ensureRollingArchive(key, { storeRoot, claudeConfigDir, cwd: seedOptions.cwd,
      sourceResumeFrom: 'fixed', fixedMigration: true, importLocalSession })
    expect(importLocalSession).toHaveBeenCalledWith('fixed', expect.anything(), { dir: seedOptions.cwd, includeSubagents: false })
    expect(archive.every(item => item.ob2ArchiveUuid === item.uuid)).toBe(true)
    const seed = createArchiveRevisionSeed(archive, context, [], { ...seedOptions, storeRoot })!
    await materializeRollingHistorySeed(seed)
    const legacyKey = { ...key, laneId: 'api:legacy' }
    const legacy = await ensureRollingArchive(legacyKey, { storeRoot, claudeConfigDir, cwd: seedOptions.cwd,
      sourceResumeFrom: seed.resumeFrom, importLocalSession })
    expect(importLocalSession).toHaveBeenCalledOnce()
    expect(legacy).toEqual(seed.entries)
    expect(await readRollingArchive(legacyKey, { storeRoot })).toEqual(seed.entries)
  }))

  it('synchronizes idempotently including retry after archive append but before transcript marking', async () => withStore(async (storeRoot, claudeConfigDir) => {
    const source = nativeRound('native', '2026-09-12T10:00:00Z')
    const importLocalSession = vi.fn(async (_id, store) => { await store.append({ projectKey: '', sessionId: 'native' }, source) })
    const options = { ...key, storeRoot, claudeConfigDir, importLocalSession }
    await appendRollingArchive(key, source, options)
    await syncRollingNativeSession('native', seedOptions.cwd, options)
    await syncRollingNativeSession('native', seedOptions.cwd, options)
    expect(await readRollingArchive(key, options)).toHaveLength(source.length)
    const durable = await openRollingHistoryResume('native', { storeRoot })!.sessionStore.load({ projectKey: '', sessionId: 'native' })
    expect(durable!.every(item => Boolean(item.ob2ArchiveUuid))).toBe(true)
    const clone = cloneRollingTranscriptForSession(durable!, 'next')
    await appendRollingArchive(key, clone, options)
    expect(await readRollingArchive(key, options)).toHaveLength(source.length)
  }))

  it('all dates review/omit → empty seed → new-session round appended → raw restores old and new rounds', async () => withStore(async (storeRoot, claudeConfigDir) => {
    await appendRollingArchive(key, [...nativeRound('old', '2026-09-11T10:00:00Z'), ...nativeRound('review', '2026-09-12T10:00:00Z')], { storeRoot })
    const archive = (await readRollingArchive(key, { storeRoot }))!
    const emptyContext = { ...context, day_modes: { '2026-09-11': 'omit', '2026-09-12': 'review' } } as typeof context
    expect(createArchiveRevisionSeed(archive, emptyContext, [], { ...seedOptions, storeRoot })).toBeNull()
    expect(await readRollingArchive(key, { storeRoot })).toEqual(archive)
    const freshRound = nativeRound('fresh', '2026-09-13T10:00:00Z')
    await syncRollingNativeSession('fresh-session', seedOptions.cwd, { ...key, storeRoot, claudeConfigDir,
      importLocalSession: async (_id, store) => { await store.append({ projectKey: '', sessionId: 'fresh-session' }, freshRound) } })
    const updated = (await readRollingArchive(key, { storeRoot }))!
    expect(updated).toHaveLength(archive.length + freshRound.length)
    const seed = createArchiveRevisionSeed(updated, { ...emptyContext, day_modes: { ...emptyContext.day_modes, '2026-09-11': 'raw' } }, [], { ...seedOptions, storeRoot })!
    expect(JSON.stringify(seed.entries)).toContain('question-old')
    expect(JSON.stringify(seed.entries)).toContain('tool-old')
    expect(JSON.stringify(seed.entries)).toContain('question-fresh')
    expect(JSON.stringify(seed.entries)).toContain('thinking-fresh')
    expect(JSON.stringify(seed.entries)).not.toContain('question-review')
  }))

  it('fails explicitly when native sources are missing; never substitutes Haven body silently', async () => withStore(async storeRoot => {
    await expect(ensureRollingArchive(key, { storeRoot, cwd: seedOptions.cwd, sourceResumeFrom: 'lost', hasHistory: true,
      importLocalSession: async () => { throw new Error('session not found') } })).rejects.toThrow('上下文检查页确认正文重建')
    expect(await readRollingArchive(key, { storeRoot })).toBeNull()
  }))

  it('manual body recovery initializes the full archive, so omitted dates can later be restored', async () => withStore(async storeRoot => {
    const bodyTurns = [turns[0], { ...turns[0], id: 4, chat_day: '2026-09-12', created_at: '2026-09-12T10:00:00Z' }]
    const seed = await createManualRollingArchiveRecoverySeed(key, bodyTurns, { ...context, day_modes: { '2026-09-11': 'omit' } }, { ...seedOptions, storeRoot })
    expect(seed?.source).toBe('manual_body_recovery')
    expect(seed?.entries).toHaveLength(2)
    const archive = (await readRollingArchive(key, { storeRoot }))!
    expect(archive).toHaveLength(4)
    expect(archive.every(item => item.ob2ArchiveUuid && item.ob2RollingFidelity === 'body_restored')).toBe(true)
    expect(createArchiveRevisionSeed(archive, context, bodyTurns, { ...seedOptions, storeRoot })!.entries).toHaveLength(4)
    await expect(createManualRollingArchiveRecoverySeed(key, bodyTurns, context, { ...seedOptions, storeRoot })).rejects.toThrow('存档仍存在')
  }))

  it('materializes the seed before resume and audits archive dates without writes', async () => withStore(async (storeRoot, claudeConfigDir) => {
    await appendRollingArchive(key, nativeRound('latest', '2026-09-12T10:00:00Z'), { storeRoot })
    const archive = (await readRollingArchive(key, { storeRoot }))!
    const seed = createArchiveRevisionSeed(archive, context, [], { ...seedOptions, storeRoot })!
    expect(openRollingHistoryResume(seed.resumeFrom, { storeRoot })).toBeNull()
    await materializeRollingNativeSession(seed, seedOptions.cwd, { claudeConfigDir })
    expect(openRollingHistoryResume(seed.resumeFrom, { storeRoot })).not.toBeNull()
    expect(await inspectRollingHistoryTranscript(seed.resumeFrom, { storeRoot })).toMatchObject({ entryCount: 6 })
    expect(await inspectRollingArchive(key, context, [], { storeRoot })).toMatchObject({
      available: true, entryCount: 6, firstDay: '2026-09-12', lastDay: '2026-09-12', days: [{ day: '2026-09-12', envelopeCount: 1 }],
    })
    expect(await readRollingArchive(key, { storeRoot })).toEqual(archive)
  }))

  it('keeps the revision parentUuid chain unbroken when a forked source carries a uuid-bearing custom-title', async () => withStore(async storeRoot => {
    const source = [
      ...nativeRound('before', '2026-09-11T10:00:00Z'),
      { type: 'custom-title', uuid: 'fork-title', customTitle: 'Context GC cleaned fork', sessionId: 'synthetic-native' },
      ...nativeRound('after', '2026-09-12T10:00:00Z'),
    ] as SessionStoreEntry[]
    await appendRollingArchive(key, source, { storeRoot })
    const seed = createArchiveRevisionSeed((await readRollingArchive(key, { storeRoot }))!, context, [], { ...seedOptions, storeRoot })!
    expect(seed.entries.some(item => item.type === 'custom-title')).toBe(false)
    const byUuid = new Map(seed.entries.map(item => [item.uuid, item]))
    let current = seed.entries.at(-1)
    let reachable = 0
    while (current) {
      reachable += 1
      current = current.parentUuid ? byUuid.get(current.parentUuid as string) : undefined
    }
    expect(reachable).toBe(seed.entries.length)
    expect(JSON.stringify(seed.entries)).toContain('question-before')
  }))

  it('keeps resume keys isolated by lane/revision and permanent Haven IDs in visible history', () => {
    expect(ccResumeKey('window', 'subscription', 1)).not.toBe(ccResumeKey('window', 'subscription', 2))
    expect(ccResumeHintForContext({ persistedHint: 'native', legacyHint: '', laneContextRevision: 1, contextRevision: 2, isRolling: true })).toBe('')
    expect(turnsToMessages(turns).map(message => message.id)).toEqual(['msg_user_3', 'msg_assistant_3'])
  })
})
