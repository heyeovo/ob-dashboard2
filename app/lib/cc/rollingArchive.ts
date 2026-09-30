import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import type { HavenTurn, RollingContextConfig } from '@/app/lib/havenTurns'
import {
  buildRollingTranscriptEntries, captureLocalTranscript, cloneRollingTranscriptForSession,
  createManualRollingBodyRecoverySeed,
  nativeClaudeSessionFile, openRollingHistoryResume, pruneCompletedThinking,
  prunePersistedRecall, rollingStoreRoot, RollingSeedStore, seedDiagnostic,
  stripStaleSystemReminders, transcriptEnvelopes,
  type ImportLocalSession, type RollingHistorySeed,
} from './rollingHistory'

type ArchiveKey = { havenSessionId: string; laneId: string }
type ArchiveIO = { storeRoot?: string }
export type ArchiveContext = Pick<RollingContextConfig, 'timezone' | 'day_start_hour' | 'day_modes'>
export type ArchiveDayAudit = {
  day: string
  envelopeCount: number
  treatment: 'full' | 'pruned' | 'removed' | 'body_restored'
  thinkingPrunedBlockCount: number
  memoryRecallPrunedBlockCount: number
  attachmentPrunedBlockCount: number
}

function archiveFile(key: ArchiveKey, options: ArchiveIO): string {
  return path.join(/*turbopackIgnore: true*/ options.storeRoot || rollingStoreRoot(), 'archive',
    Buffer.from(key.havenSessionId).toString('base64url'),
    `${Buffer.from(key.laneId).toString('base64url')}.jsonl`)
}

/** UUID-less SDK metadata is not model-visible. Visible entries must always have native UUIDs. */
function archiveEligibleEntries(entries: SessionStoreEntry[]): SessionStoreEntry[] {
  return entries.filter(entry => {
    if (typeof entry.uuid === 'string' && entry.uuid) return true
    if (['user', 'assistant', 'attachment'].includes(String(entry.type))) {
      throw new Error(`模型可见 ${entry.type} entry 缺少 uuid，已停止原生存档处理`)
    }
    return false
  })
}

/** null means missing; [] is an initialized archive for a new, empty window. */
export async function readRollingArchive(key: ArchiveKey, options: ArchiveIO = {}): Promise<SessionStoreEntry[] | null> {
  try {
    return (await readFile(/*turbopackIgnore: true*/ archiveFile(key, options), 'utf8'))
      .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as SessionStoreEntry)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Pure marking: archive UUIDs survive clones; native UUIDs also deduplicate a interrupted sync. */
export function markArchiveEntries(archive: SessionStoreEntry[], incoming: SessionStoreEntry[]): {
  entries: SessionStoreEntry[]; appended: SessionStoreEntry[]
} {
  const eligible = new Set(archiveEligibleEntries(incoming))
  const known = new Set(archive.map(entry => String(entry.ob2ArchiveUuid)))
  const appended: SessionStoreEntry[] = []
  const entries = incoming.map(entry => {
    if (!eligible.has(entry)) return { ...entry }
    if (entry.ob2ArchiveUuid) return { ...entry }
    const marked = { ...entry, ob2ArchiveUuid: entry.uuid }
    if (!known.has(String(entry.uuid))) {
      appended.push(marked)
      known.add(String(entry.uuid))
    }
    return marked
  })
  return { entries, appended }
}

/** Caller holds the window's turn coordinator lock. Never rewrites archive bytes. */
export async function appendRollingArchive(
  key: ArchiveKey, incoming: SessionStoreEntry[], options: ArchiveIO = {},
): Promise<ReturnType<typeof markArchiveEntries>> {
  const archive = await readRollingArchive(key, options)
  const marked = markArchiveEntries(archive || [], incoming)
  // Initialization copies the entire source, even if a surviving revision already carries markers.
  if (archive === null) marked.appended = [...new Map(archiveEligibleEntries(marked.entries)
    .map(entry => [entry.ob2ArchiveUuid, entry])).values()]
  const file = archiveFile(key, options)
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
  if (marked.appended.length || archive === null) {
    await appendFile(/*turbopackIgnore: true*/ file,
      marked.appended.map(entry => `${JSON.stringify(entry)}\n`).join(''), { encoding: 'utf8', mode: 0o600 })
  }
  return marked
}

async function persistMarkedTranscript(
  sessionId: string, cwd: string, entries: SessionStoreEntry[], options: ArchiveIO & { claudeConfigDir?: string },
): Promise<void> {
  if (!entries.length) return
  await new RollingSeedStore(sessionId, [], options.storeRoot).replace(sessionId, entries)
  const file = await nativeClaudeSessionFile(sessionId, cwd, options.claudeConfigDir)
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = path.join(/*turbopackIgnore: true*/ path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  await writeFile(temp, entries.map(entry => `${JSON.stringify(entry)}\n`).join(''), { encoding: 'utf8', mode: 0o600 })
  await rename(temp, file)
}

/** Fixed migration imports native history; legacy rolling migration uses its durable revision. */
export async function ensureRollingArchive(
  key: ArchiveKey,
  options: ArchiveIO & {
    cwd: string; sourceResumeFrom?: string; fixedMigration?: boolean; hasHistory?: boolean
    importLocalSession?: ImportLocalSession; claudeConfigDir?: string
  },
): Promise<SessionStoreEntry[]> {
  const existing = await readRollingArchive(key, options)
  if (existing !== null) return existing
  const sourceId = options.sourceResumeFrom || ''
  const persisted = !options.fixedMigration && sourceId ? openRollingHistoryResume(sourceId, options) : null
  const source = persisted
    ? await persisted.sessionStore.load({ projectKey: '', sessionId: sourceId })
    : sourceId ? await captureLocalTranscript(sourceId, options.cwd, options.importLocalSession) : null
  if (!source?.length && (sourceId || options.hasHistory)) {
    throw new Error('原生存档与 transcript 都不存在，已停止本轮；请在上下文检查页确认正文重建')
  }
  const marked = await appendRollingArchive(key, source || [], options)
  return archiveEligibleEntries(marked.entries)
}

/** Shift local wall-clock time before taking its date, matching Haven's chat-day formula. */
export function archiveChatDay(timestamp: string, context: ArchiveContext): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new Error('原生存档轮次缺少有效 timestamp，无法计算 chat_day')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: context.timezone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const shifted = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour) - (context.day_start_hour ?? 4), Number(values.minute), Number(values.second)))
  return shifted.toISOString().slice(0, 10)
}

export function archiveEnvelopes(entries: SessionStoreEntry[], context: ArchiveContext) {
  // Only parentUuid chain nodes go into a revision. forkSession writes a `custom-title`
  // that carries a uuid but no parentUuid; linking it into the chain makes resume stop there.
  const revisionEntries = archiveEligibleEntries(entries).filter(entry => 'parentUuid' in entry
    && !(entry.type === 'system' && entry.subtype === 'compact_boundary')
    && !(entry.type === 'user' && entry.isCompactSummary === true))
  return transcriptEnvelopes(revisionEntries).envelopes.map(envelope => ({
    ...envelope, day: archiveChatDay(envelope.timestamp, context),
  }))
}

/** Pure slicing. Haven is used only for entire raw dates absent from the archive. */
export function sliceRollingArchive(
  archive: SessionStoreEntry[], context: ArchiveContext, rawTurns: HavenTurn[],
  options: { cwd: string; fallbackModel: string },
): { entries: SessionStoreEntry[]; days: ArchiveDayAudit[]; bodyRestoredTurnCount: number } {
  const envelopes = archiveEnvelopes(archive, context)
  const byDay = new Map<string, typeof envelopes>()
  for (const envelope of envelopes) byDay.set(envelope.day, [...(byDay.get(envelope.day) || []), envelope])
  const lastDay = [...byDay.keys()].sort().at(-1)
  const missingDays = [...new Set(rawTurns.map(turn => turn.chat_day || '').filter(Boolean))]
    .filter(day => !byDay.has(day) && (context.day_modes[day] || 'raw') === 'raw')
  const entries: SessionStoreEntry[] = []
  const days: ArchiveDayAudit[] = []
  let bodyRestoredTurnCount = 0
  for (const day of [...new Set([...byDay.keys(), ...missingDays])].sort()) {
    const group = byDay.get(day)
    const row: ArchiveDayAudit = {
      day, envelopeCount: group?.length || 0, treatment: 'removed',
      thinkingPrunedBlockCount: 0, memoryRecallPrunedBlockCount: 0, attachmentPrunedBlockCount: 0,
    }
    if ((context.day_modes[day] || 'raw') === 'raw') {
      if (!group) {
        const turns = rawTurns.filter(turn => turn.chat_day === day)
        entries.push(...buildRollingTranscriptEntries(turns, { ...options, sessionId: randomUUID() })
          .map(entry => ({ ...entry, ob2RollingFidelity: 'body_restored' })))
        bodyRestoredTurnCount += turns.length
        row.treatment = 'body_restored'
      } else {
        row.treatment = group.some(envelope => envelope.entries.some(entry => entry.ob2RollingFidelity === 'body_restored'))
          ? 'body_restored' : day === lastDay ? 'full' : 'pruned'
        for (const envelope of group) {
          if (day === lastDay) entries.push(...envelope.entries)
          else {
            const recall = prunePersistedRecall(envelope.entries)
            const thinking = pruneCompletedThinking(recall.entries)
            const attachments = stripStaleSystemReminders(thinking.entries)
            row.memoryRecallPrunedBlockCount += recall.removedBlockCount
            row.thinkingPrunedBlockCount += thinking.removedBlockCount
            row.attachmentPrunedBlockCount += attachments.removedBlockCount
            entries.push(...attachments.entries)
          }
        }
      }
    }
    days.push(row)
  }
  return { entries, days, bodyRestoredTurnCount }
}

export function createArchiveRevisionSeed(
  archive: SessionStoreEntry[], context: ArchiveContext, rawTurns: HavenTurn[],
  options: ArchiveIO & { cwd: string; fallbackModel: string; sourceSessionId?: string; rebase?: boolean },
): RollingHistorySeed | null {
  const sliced = sliceRollingArchive(archive, context, rawTurns, options)
  if (!sliced.entries.length) return null
  const resumeFrom = randomUUID()
  const entries = cloneRollingTranscriptForSession(sliced.entries, resumeFrom)
  return {
    resumeFrom, entries, sessionStore: new RollingSeedStore(resumeFrom, entries, options.storeRoot),
    source: options.rebase ? 'model_surface_rebase' : 'archive_seed',
    diagnostic: seedDiagnostic(entries, {
      sourceSessionId: options.sourceSessionId || '', sourceEntryCount: archive.length,
      retainedEnvelopeCount: sliced.days.filter(day => day.treatment !== 'removed').reduce((sum, day) => sum + day.envelopeCount, 0),
      bodyRestoredTurnCount: sliced.bodyRestoredTurnCount,
      thinkingPrunedBlockCount: sliced.days.reduce((sum, day) => sum + day.thinkingPrunedBlockCount, 0),
      memoryRecallPrunedBlockCount: sliced.days.reduce((sum, day) => sum + day.memoryRecallPrunedBlockCount, 0),
      attachmentPrunedBlockCount: sliced.days.reduce((sum, day) => sum + day.attachmentPrunedBlockCount, 0),
      days: sliced.days,
    }),
  }
}

/** Explicit recovery only: the whole Haven body history becomes the new archive. */
export async function createManualRollingArchiveRecoverySeed(
  key: ArchiveKey, turns: HavenTurn[], context: ArchiveContext,
  options: ArchiveIO & { cwd: string; fallbackModel: string },
): Promise<RollingHistorySeed | null> {
  if (await readRollingArchive(key, options) !== null) throw new Error('原生存档仍存在，不能用正文重建替换')
  const body = createManualRollingBodyRecoverySeed(turns, options)
  if (!body) return null
  const marked = await appendRollingArchive(key, body.entries, options)
  const seed = createArchiveRevisionSeed(marked.entries, context, turns, options)
  if (seed) seed.source = 'manual_body_recovery'
  return seed
}

/** Runs before the existing turn lock is released, including new sessions after empty slicing. */
export async function syncRollingNativeSession(
  sessionId: string, cwd: string, options: ArchiveKey & ArchiveIO & {
    importLocalSession?: ImportLocalSession; claudeConfigDir?: string
  },
): Promise<number> {
  if (!sessionId.trim()) throw new Error('滚动 transcript 同步缺少 Claude session id')
  const entries = await captureLocalTranscript(sessionId, cwd, options.importLocalSession)
  if (!entries?.length) throw new Error('Claude 原生 transcript 不存在或为空，无法同步滚动存档')
  const marked = await appendRollingArchive(options, entries, options)
  await persistMarkedTranscript(sessionId, cwd, marked.entries, options)
  return marked.entries.length
}

/** Read-only archive facts and a preview for current settings; no source import or writes. */
export async function inspectRollingArchive(
  key: ArchiveKey, context: ArchiveContext, rawTurns: HavenTurn[], options: ArchiveIO = {},
) {
  const archive = await readRollingArchive(key, options)
  if (archive === null) return { available: false, entryCount: 0, firstDay: '', lastDay: '', days: [], revisionDays: [] }
  const envelopes = archiveEnvelopes(archive, context)
  const counts = new Map<string, number>()
  for (const envelope of envelopes) counts.set(envelope.day, (counts.get(envelope.day) || 0) + 1)
  const days = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([day, envelopeCount]) => ({ day, envelopeCount }))
  return {
    available: true, entryCount: archive.length, firstDay: days.at(0)?.day || '', lastDay: days.at(-1)?.day || '', days,
    revisionDays: sliceRollingArchive(archive, context, rawTurns, { cwd: '', fallbackModel: '' }).days,
  }
}
