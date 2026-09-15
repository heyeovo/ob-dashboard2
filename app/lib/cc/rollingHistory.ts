import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  importSessionToStore,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk'
import type { HavenTurn } from '@/app/lib/havenTurns'
import { beijingRuntimeContext } from '@/app/lib/runtimeContext'

export type RollingHistorySeed = {
  resumeFrom: string
  sessionStore: SessionStore
  entries: SessionStoreEntry[]
  source: 'new_seed' | 'manual_body_recovery' | 'revision_seed' | 'fixed_transcript_migration' | 'legacy_transcript_recovery' | 'persisted'
  diagnostic?: RollingSeedDiagnostic
}

export type RollingSeedDiagnostic = {
  sourceSessionId: string
  sourceEntryCount: number
  retainedEnvelopeCount: number
  bodyRestoredTurnCount: number
  thinkingPrunedBlockCount: number
  toolUseCount: number
  toolResultCount: number
  memoryRecallCount: number
}

export type RollingTranscriptAudit = {
  entryCount: number
  messages: Array<{
    index: number
    uuid: string
    role: string
    content: string
    chars: number
    containsRollingWindowContext: boolean
    containsMemoryRecall: boolean
    blockTypes: string[]
    toolNames: string[]
    bodyRestored: boolean
  }>
}

type TranscriptSeedOptions = {
  sessionId: string
  cwd: string
  fallbackModel: string
}

type TranscriptEnvelope = {
  entries: SessionStoreEntry[]
  userText: string
  assistantText: string
  havenTurnId: number | null
  timestamp: string
}

export function rollingRevisionRequiresSource(
  isRolling: boolean,
  laneContextRevision: number,
  contextRevision: number,
  previousStrategy: string,
): boolean {
  return isRolling
    && laneContextRevision !== contextRevision
    && previousStrategy !== 'fixed_window'
}

export function assertRequiredRollingRevisionSeed(
  required: boolean,
  rawTurnCount: number,
  sourceResumeFrom: string,
  revisionSeed: RollingHistorySeed | null,
): void {
  if (!required || rawTurnCount === 0 || revisionSeed) return
  throw new Error(sourceResumeFrom
    ? '旧滚动 transcript 持久副本不存在或无法完整对齐，已停止本轮，raw 原文没有被正文替代'
    : '无法确定旧滚动 transcript 的 session，已停止本轮，raw 原文没有被正文替代')
}

export function assertFixedMigrationSeed(
  fixedMigration: boolean,
  rawTurnCount: number,
  allowBodyRestore: boolean,
  migrationSeed: RollingHistorySeed | null,
): void {
  if (!fixedMigration || rawTurnCount === 0 || migrationSeed || allowBodyRestore) return
  throw new Error('找不到固定窗口的原生 transcript，已停止首次开启滚动；如接受仅恢复 user/assistant 正文，请在设置中重新确认')
}

export function assertRollingResumeRecovered(
  recoveryRequired: boolean,
  persistedSeed: RollingHistorySeed | null,
  recoveredSeed: RollingHistorySeed | null,
): void {
  if (!recoveryRequired || persistedSeed || recoveredSeed) return
  throw new Error('滚动窗口的完整 transcript 存档不存在，已停止本轮，避免静默退化为仅有 user/assistant 正文')
}

export function assertRollingSeedAvailable(
  required: boolean,
  rawTurnCount: number,
  seed: RollingHistorySeed | null,
): void {
  if (!required || rawTurnCount === 0 || seed) return
  throw new Error('滚动窗口没有可用的完整 transcript，已停止本轮，禁止静默改用 Haven 正文新建会话')
}

// 与 package.json 固定的 @anthropic-ai/claude-agent-sdk 0.3.222 对应。
const CLAUDE_CODE_VERSION = '2.1.222'

function wakeInput(turn: HavenTurn): string {
  let cause = 'agent_schedule'
  let reason = ''
  let occurredAt = turn.created_at
  if (turn.raw_json) {
    try {
      const raw = JSON.parse(turn.raw_json) as Record<string, unknown>
      const wake = raw.agent_wake && typeof raw.agent_wake === 'object'
        ? raw.agent_wake as Record<string, unknown>
        : null
      if (wake) {
        cause = String(wake.cause || cause)
        reason = String(wake.reason || '')
        const wakeAt = String(wake.at || '')
        if (Number.isFinite(new Date(wakeAt).getTime())) occurredAt = wakeAt
      }
    } catch {
      // 旧记录没有可解析的 raw_json 时，仍保留“系统唤醒”语义。
    }
  }
  const attributes = [
    `cause=${JSON.stringify(cause)}`,
    reason ? `reason=${JSON.stringify(reason)}` : '',
  ].filter(Boolean)
  return appendRuntimeContext(`<agent_wake ${attributes.join(' ')}/>`, occurredAt)
}

function appendRuntimeContext(content: string, timestamp: string): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return content
  return `${content}\n\n${beijingRuntimeContext(date)}`
}

/**
 * Claude Agent SDK 的 streaming input 运行时只接受 user 消息，不能用它回放
 * assistant 历史。滚动窗口因此要先构造一份原生 transcript，再从它 resume。
 *
 * 主动唤醒在 Haven 中是 assistant-only；原始模型调用实际先收到过一条隐藏的
 * <agent_wake/> 输入，所以冷恢复时也按同样的 user(trigger) → assistant 还原。
 */
export function buildRollingTranscriptEntries(
  turns: HavenTurn[],
  options: TranscriptSeedOptions,
): SessionStoreEntry[] {
  const entries: SessionStoreEntry[] = []
  let parentUuid: string | null = null

  const pushUser = (content: string, timestamp: string, turn: HavenTurn) => {
    const uuid = randomUUID()
    entries.push({
      type: 'user', uuid, parentUuid, timestamp,
      ob2HavenTurnId: turn.id, ob2ChatDay: turn.chat_day || '',
      sessionId: options.sessionId, cwd: options.cwd,
      isSidechain: false, userType: 'external',
      version: CLAUDE_CODE_VERSION, gitBranch: 'HEAD',
      permissionMode: 'default', promptSource: 'sdk', entrypoint: 'sdk-ts',
      promptId: randomUUID(),
      message: { role: 'user', content },
    })
    parentUuid = uuid
  }

  const pushAssistant = (content: string, timestamp: string, model: string, turn: HavenTurn) => {
    const uuid = randomUUID()
    entries.push({
      type: 'assistant', uuid, parentUuid, timestamp,
      ob2HavenTurnId: turn.id, ob2ChatDay: turn.chat_day || '',
      sessionId: options.sessionId, cwd: options.cwd,
      isSidechain: false, userType: 'external',
      version: CLAUDE_CODE_VERSION, gitBranch: 'HEAD',
      requestId: `req_01${randomUUID().replace(/-/g, '')}`,
      message: {
        id: `msg_01${uuid.replace(/-/g, '')}`,
        type: 'message', role: 'assistant',
        model: model || options.fallbackModel || 'claude',
        content: [{ type: 'text', text: content }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          service_tier: 'standard',
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          inference_geo: '', iterations: [], speed: 'standard',
        },
      },
    })
    parentUuid = uuid
  }

  for (const turn of turns) {
    const userText = turn.user_text.trim()
    const assistantText = turn.assistant_text.trim()
    if (turn.turn_kind === 'agent_wake' && assistantText) {
      pushUser(wakeInput(turn), turn.created_at, turn)
      pushAssistant(assistantText, turn.created_at, turn.model, turn)
      continue
    }
    if (userText) pushUser(appendRuntimeContext(userText, turn.created_at), turn.created_at, turn)
    if (assistantText) {
      if (!userText) {
        pushUser(appendRuntimeContext('<system_generated_turn source="restored_history"/>', turn.created_at), turn.created_at, turn)
      }
      pushAssistant(assistantText, turn.created_at, turn.model, turn)
    }
  }
  return entries
}

function rollingStoreRoot(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.'
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim() || `${homeDir}${path.sep}.claude`
  return path.join(/*turbopackIgnore: true*/ claudeConfigDir, 'ob2-rolling-session-store-v1')
}

function encodedPart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url') || 'main'
}

class RollingSeedStore implements SessionStore {
  private readonly initialSessions = new Map<string, SessionStoreEntry[]>()
  private readonly pendingWrites = new Map<string, Promise<void>>()

  constructor(
    sessionId: string,
    entries: SessionStoreEntry[],
    private readonly storeRoot = rollingStoreRoot(),
  ) {
    if (entries.length > 0) {
      this.initialSessions.set(this.key({ projectKey: '', sessionId }), [...entries])
    }
  }

  private key(key: SessionKey): string {
    return `${key.sessionId}::${key.subpath || ''}`
  }

  private filePath(key: SessionKey): string {
    const sessionDir = path.join(/*turbopackIgnore: true*/ this.storeRoot, encodedPart(key.sessionId))
    const filename = key.subpath ? `${encodedPart(key.subpath)}.jsonl` : 'main.jsonl'
    return path.join(/*turbopackIgnore: true*/ sessionDir, filename)
  }

  hasPersistedSession(sessionId: string): boolean {
    return existsSync(/*turbopackIgnore: true*/ this.filePath({ projectKey: '', sessionId }))
  }

  async materialize(sessionId: string): Promise<void> {
    const key = { projectKey: '', sessionId }
    const storageKey = this.key(key)
    if (this.hasPersistedSession(sessionId)) return
    const entries = this.initialSessions.get(storageKey)
    if (!entries?.length) throw new Error('滚动 transcript 没有可持久化的种子内容')
    const file = this.filePath(key)
    await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = path.join(
      /*turbopackIgnore: true*/ path.dirname(file),
      `.${path.basename(file)}.${randomUUID()}.tmp`,
    )
    await writeFile(temp, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, {
      encoding: 'utf8', mode: 0o600,
    })
    await rename(temp, file)
    this.initialSessions.delete(storageKey)
  }

  async replace(sessionId: string, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) throw new Error('滚动 transcript 同步结果为空')
    const key = { projectKey: '', sessionId }
    const storageKey = this.key(key)
    const previous = this.pendingWrites.get(storageKey) || Promise.resolve()
    const write = previous.then(async () => {
      const file = this.filePath(key)
      await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
      const temp = path.join(
        /*turbopackIgnore: true*/ path.dirname(file),
        `.${path.basename(file)}.${randomUUID()}.tmp`,
      )
      await writeFile(temp, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, {
        encoding: 'utf8', mode: 0o600,
      })
      await rename(temp, file)
      this.initialSessions.delete(storageKey)
    })
    this.pendingWrites.set(storageKey, write)
    try {
      await write
    } finally {
      if (this.pendingWrites.get(storageKey) === write) this.pendingWrites.delete(storageKey)
    }
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return
    const storageKey = this.key(key)
    const previous = this.pendingWrites.get(storageKey) || Promise.resolve()
    const write = previous.then(async () => {
      const file = this.filePath(key)
      await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
      const initial = existsSync(/*turbopackIgnore: true*/ file) ? [] : this.initialSessions.get(storageKey) || []
      const batch = [...initial, ...entries]
      await appendFile(/*turbopackIgnore: true*/ file, `${batch.map(entry => JSON.stringify(entry)).join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      this.initialSessions.delete(storageKey)
    })
    this.pendingWrites.set(storageKey, write)
    try {
      await write
    } finally {
      if (this.pendingWrites.get(storageKey) === write) this.pendingWrites.delete(storageKey)
    }
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const pending = this.pendingWrites.get(this.key(key))
    if (pending) await pending
    try {
      const content = await readFile(/*turbopackIgnore: true*/ this.filePath(key), 'utf8')
      return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as SessionStoreEntry)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const entries = this.initialSessions.get(this.key(key))
      return entries ? [...entries] : null
    }
  }
}

class CaptureSessionStore implements SessionStore {
  readonly entries: SessionStoreEntry[] = []

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (!key.subpath) this.entries.push(...entries)
  }

  async load(): Promise<SessionStoreEntry[] | null> {
    return this.entries.length ? [...this.entries] : null
  }
}

export function openRollingHistoryResume(
  resumeFrom: string,
  options: { storeRoot?: string } = {},
): RollingHistorySeed | null {
  const normalized = resumeFrom.trim()
  if (!normalized) return null
  const sessionStore = new RollingSeedStore(normalized, [], options.storeRoot)
  if (!sessionStore.hasPersistedSession(normalized)) return null
  return { resumeFrom: normalized, sessionStore, entries: [], source: 'persisted' }
}

function transcriptMessageContent(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (!block || typeof block !== 'object') return ''
    const value = (block as Record<string, unknown>).text
    return typeof value === 'string' ? value : ''
  }).filter(Boolean).join('\n')
}

function transcriptMessageAuditContent(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (!block || typeof block !== 'object') return String(block || '')
    const record = block as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
    if (record.type === 'tool_use') {
      return `[tool_use ${String(record.name || '')} · ${String(record.id || '')}]\n${JSON.stringify(record.input ?? {}, null, 2)}`
    }
    if (record.type === 'tool_result') {
      const result = typeof record.content === 'string'
        ? record.content
        : JSON.stringify(record.content ?? null, null, 2)
      return `[tool_result · ${String(record.tool_use_id || '')}]\n${result}`
    }
    return JSON.stringify(record, null, 2)
  }).filter(Boolean).join('\n')
}

function entryBlockTypes(message: Record<string, unknown> | null): string[] {
  if (!message) return []
  const content = message.content
  if (typeof content === 'string') return ['text']
  if (!Array.isArray(content)) return []
  return content.map(block => block && typeof block === 'object'
    ? String((block as Record<string, unknown>).type || 'unknown')
    : 'unknown')
}

function entryToolNames(message: Record<string, unknown> | null): string[] {
  if (!message) return []
  return contentBlocks(message)
    .filter(block => block.type === 'tool_use')
    .map(block => String(block.name || ''))
    .filter(Boolean)
}

function seedDiagnostic(entries: SessionStoreEntry[], overrides: Partial<RollingSeedDiagnostic>): RollingSeedDiagnostic {
  const messages = entries.map(entry => messageRecord(entry))
  return {
    sourceSessionId: '',
    sourceEntryCount: 0,
    retainedEnvelopeCount: 0,
    bodyRestoredTurnCount: 0,
    thinkingPrunedBlockCount: 0,
    toolUseCount: messages.reduce((sum, message) => sum + entryBlockTypes(message).filter(type => type === 'tool_use').length, 0),
    toolResultCount: messages.reduce((sum, message) => sum + entryBlockTypes(message).filter(type => type === 'tool_result').length, 0),
    memoryRecallCount: messages.filter(message => /<记忆召回>|<memory_card\b/i.test(transcriptMessageContent(message))).length,
    ...overrides,
  }
}

function messageRecord(entry: SessionStoreEntry): Record<string, unknown> | null {
  const raw = entry as Record<string, unknown>
  return raw.message && typeof raw.message === 'object'
    ? raw.message as Record<string, unknown>
    : null
}

function contentBlocks(message: Record<string, unknown>): Array<Record<string, unknown>> {
  const content = message.content
  if (!Array.isArray(content)) return []
  return content.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
}

function pruneCompletedThinking(entries: SessionStoreEntry[]): {
  entries: SessionStoreEntry[]
  removedBlockCount: number
} {
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()
  for (const entry of entries) {
    const message = messageRecord(entry)
    if (!message) continue
    for (const block of contentBlocks(message)) {
      if (block.type === 'tool_use' && block.id) toolUseIds.add(String(block.id))
      if (block.type === 'tool_result' && block.tool_use_id) toolResultIds.add(String(block.tool_use_id))
    }
  }
  if ([...toolUseIds].some(id => !toolResultIds.has(id))) {
    return { entries, removedBlockCount: 0 }
  }

  let removedBlockCount = 0
  const prunedEntries = entries.flatMap(entry => {
    const cloned = JSON.parse(JSON.stringify(entry)) as SessionStoreEntry
    const message = messageRecord(cloned)
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return [cloned]
    const content = contentBlocks(message).filter(block => {
      const shouldRemove = block.type === 'thinking' || block.type === 'redacted_thinking'
      if (shouldRemove) removedBlockCount += 1
      return !shouldRemove
    })
    if (content.length === 0) return []
    message.content = content
    return [cloned]
  })
  return { entries: prunedEntries, removedBlockCount }
}

function isPrimaryUserEntry(entry: SessionStoreEntry): boolean {
  const message = messageRecord(entry)
  if (entry.type !== 'user' || message?.role !== 'user') return false
  const blocks = contentBlocks(message)
  return !blocks.some(block => block.type === 'tool_result')
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function transcriptEnvelopes(entries: SessionStoreEntry[]): {
  prefix: SessionStoreEntry[]
  envelopes: TranscriptEnvelope[]
} {
  const prefix: SessionStoreEntry[] = []
  const envelopes: TranscriptEnvelope[] = []
  let current: SessionStoreEntry[] | null = null
  for (const entry of entries) {
    if (isPrimaryUserEntry(entry)) {
      if (current) envelopes.push(toEnvelope(current))
      current = [entry]
    } else if (current) {
      current.push(entry)
    } else {
      prefix.push(entry)
    }
  }
  if (current) envelopes.push(toEnvelope(current))
  return { prefix, envelopes }
}

function toEnvelope(entries: SessionStoreEntry[]): TranscriptEnvelope {
  const primaryUser = entries.find(entry => isPrimaryUserEntry(entry))
  const userText = entries
    .filter(entry => isPrimaryUserEntry(entry))
    .map(entry => transcriptMessageContent(messageRecord(entry)))
    .filter(Boolean)
    .join('\n')
  const assistantText = entries
    .filter(entry => messageRecord(entry)?.role === 'assistant')
    .map(entry => transcriptMessageContent(messageRecord(entry)))
    .filter(Boolean)
    .join('\n')
  const havenTurnIds = [...new Set(entries
    .map(entry => Number(entry.ob2HavenTurnId))
    .filter(id => Number.isSafeInteger(id) && id > 0))]
  return {
    entries,
    userText,
    assistantText,
    havenTurnId: havenTurnIds.length === 1 ? havenTurnIds[0] : null,
    timestamp: typeof primaryUser?.timestamp === 'string' ? primaryUser.timestamp : '',
  }
}

function envelopeMatchesTurn(envelope: TranscriptEnvelope, turn: HavenTurn): boolean {
  const actualUser = normalized(envelope.userText)
  const actualAssistant = normalized(envelope.assistantText)
  const expectedAssistant = normalized(turn.assistant_text)
  const userMatches = turn.turn_kind === 'agent_wake'
    ? actualUser.includes('<agent_wake ')
    : Boolean(normalized(turn.user_text)) && actualUser.includes(normalized(turn.user_text))
  return userMatches && (!expectedAssistant || actualAssistant.includes(expectedAssistant))
}

function havenNativeTurnUuid(turn: HavenTurn): string {
  if (!turn.raw_json) return ''
  try {
    const raw = JSON.parse(turn.raw_json) as Record<string, unknown>
    return typeof raw.cc_turn_uuid === 'string' ? raw.cc_turn_uuid.trim() : ''
  } catch {
    return ''
  }
}

function closestCompletedTurnIndex(
  envelopeTimestamp: string,
  matches: Array<{ turn: HavenTurn; index: number }>,
): number | null {
  const envelopeTime = new Date(envelopeTimestamp).getTime()
  if (!Number.isFinite(envelopeTime)) return null
  const ranked = matches
    .map(match => ({
      index: match.index,
      // Haven created_at 是整轮完成落库时间；transcript timestamp 是用户进入时间。
      delay: new Date(match.turn.created_at).getTime() - envelopeTime,
    }))
    .filter(match => Number.isFinite(match.delay) && match.delay >= -1000 && match.delay <= 6 * 60 * 60 * 1000)
    .sort((a, b) => a.delay - b.delay)
  if (ranked.length === 0) return null
  if (ranked.length > 1 && ranked[0].delay === ranked[1].delay) return null
  return ranked[0].index
}

function alignEnvelopesToTurns(
  envelopes: TranscriptEnvelope[],
  turns: HavenTurn[],
): Map<number, TranscriptEnvelope> {
  const orderedTurns = [...turns].sort((a, b) => a.id - b.id)
  const candidates = envelopes.map(envelope => {
    const primaryUserUuid = envelope.entries.find(entry => isPrimaryUserEntry(entry))?.uuid || ''
    const nativeUuidMatches = primaryUserUuid
      ? orderedTurns
          .map((turn, index) => ({ turn, index }))
          .filter(({ turn }) => havenNativeTurnUuid(turn) === primaryUserUuid)
      : []
    const textMatches = orderedTurns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => envelopeMatchesTurn(envelope, turn))
    if (envelope.havenTurnId !== null) {
      return new Set(textMatches
        .filter(({ turn }) => turn.id === envelope.havenTurnId)
        .map(({ index }) => index))
    }
    if (nativeUuidMatches.length > 0) {
      return new Set(nativeUuidMatches.map(({ index }) => index))
    }
    if (textMatches.length > 1) {
      const closestIndex = closestCompletedTurnIndex(envelope.timestamp, textMatches)
      if (closestIndex !== null) return new Set([closestIndex])
    }
    return new Set(textMatches.map(({ index }) => index))
  })
  const ways = Array.from(
    { length: envelopes.length + 1 },
    () => Array<number>(orderedTurns.length + 1).fill(0),
  )
  for (let turnIndex = 0; turnIndex <= orderedTurns.length; turnIndex += 1) {
    ways[envelopes.length][turnIndex] = 1
  }
  for (let envelopeIndex = envelopes.length - 1; envelopeIndex >= 0; envelopeIndex -= 1) {
    for (let turnIndex = orderedTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const skip = ways[envelopeIndex][turnIndex + 1]
      const use = candidates[envelopeIndex].has(turnIndex)
        ? ways[envelopeIndex + 1][turnIndex + 1]
        : 0
      ways[envelopeIndex][turnIndex] = Math.min(2, skip + use)
    }
  }
  if (ways[0][0] !== 1) {
    throw new Error('旧滚动 transcript 的完整轮次无法唯一对应到 Haven，已停止更新上下文版本')
  }
  const aligned = new Map<number, TranscriptEnvelope>()
  let turnIndex = 0
  for (let envelopeIndex = 0; envelopeIndex < envelopes.length; envelopeIndex += 1) {
    while (turnIndex < orderedTurns.length) {
      const canUse = candidates[envelopeIndex].has(turnIndex)
        && ways[envelopeIndex + 1][turnIndex + 1] > 0
      if (canUse) {
        aligned.set(orderedTurns[turnIndex].id, envelopes[envelopeIndex])
        turnIndex += 1
        break
      }
      turnIndex += 1
    }
  }
  return aligned
}

export function cloneRollingTranscriptForSession(
  entries: SessionStoreEntry[],
  sessionId: string,
): SessionStoreEntry[] {
  const cloned = entries.map(entry => JSON.parse(JSON.stringify(entry)) as SessionStoreEntry)
  const uuidMap = new Map<string, string>()
  for (const entry of cloned) {
    if (typeof entry.uuid === 'string' && entry.uuid) uuidMap.set(entry.uuid, randomUUID())
  }
  let previousUuid: string | null = null
  for (const entry of cloned) {
    const oldUuid = typeof entry.uuid === 'string' ? entry.uuid : ''
    if (oldUuid) entry.uuid = uuidMap.get(oldUuid)!
    if ('sessionId' in entry) entry.sessionId = sessionId
    if ('parentUuid' in entry) entry.parentUuid = previousUuid
    if (typeof entry.uuid === 'string' && entry.uuid) previousUuid = entry.uuid
  }
  return cloned
}

/** 只读返回 SDK SessionStore 真正落盘的消息字段；不暴露 cwd、路径或其他元数据。 */
export async function inspectRollingHistoryTranscript(
  resumeFrom: string,
  options: { storeRoot?: string } = {},
): Promise<RollingTranscriptAudit | null> {
  const seed = openRollingHistoryResume(resumeFrom, options)
  if (!seed) return null
  const entries = await seed.sessionStore.load({ projectKey: 'context-audit', sessionId: seed.resumeFrom })
  if (!entries) return null
  const messages = entries.flatMap((entry, index) => {
    const record = entry as unknown as Record<string, unknown>
    const message = record.message && typeof record.message === 'object'
      ? record.message as Record<string, unknown>
      : null
    if (!message) return []
    const content = transcriptMessageAuditContent(message)
    const role = typeof message.role === 'string' ? message.role : String(record.type || '')
    if (!content || (role !== 'user' && role !== 'assistant')) return []
    const blockTypes = entryBlockTypes(message)
    return [{
      index,
      uuid: typeof record.uuid === 'string' ? record.uuid : '',
      role,
      content,
      chars: content.length,
      containsRollingWindowContext: /<rolling_window_context(?:\s|>)/i.test(content),
      containsMemoryRecall: /<记忆召回>|<memory_card\b/i.test(content),
      blockTypes,
      toolNames: entryToolNames(message),
      bodyRestored: record.ob2RollingFidelity === 'body_restored',
    }]
  })
  return { entryCount: entries.length, messages }
}

export function createRollingHistorySeed(
  turns: HavenTurn[],
  options: Omit<TranscriptSeedOptions, 'sessionId'> & { storeRoot?: string },
): RollingHistorySeed | null {
  if (turns.length === 0) return null
  const resumeFrom = randomUUID()
  const entries = buildRollingTranscriptEntries(turns, {
    cwd: options.cwd,
    fallbackModel: options.fallbackModel,
    sessionId: resumeFrom,
  })
  if (entries.length === 0) return null
  return {
    resumeFrom,
    sessionStore: new RollingSeedStore(resumeFrom, entries, options.storeRoot),
    entries,
    source: 'new_seed',
    diagnostic: seedDiagnostic(entries, { bodyRestoredTurnCount: turns.length }),
  }
}

/** 用户明确确认舍弃旧原生细节后，从 Haven 可见正文创建全新滚动 transcript。 */
export function createManualRollingBodyRecoverySeed(
  turns: HavenTurn[],
  options: Omit<TranscriptSeedOptions, 'sessionId'> & { storeRoot?: string },
): RollingHistorySeed | null {
  if (turns.length === 0) return null
  const resumeFrom = randomUUID()
  const entries = buildRollingTranscriptEntries(turns, {
    cwd: options.cwd,
    fallbackModel: options.fallbackModel,
    sessionId: resumeFrom,
  }).map(entry => ({
    ...entry,
    ob2RollingFidelity: 'body_restored',
  }))
  if (entries.length === 0) return null
  return {
    resumeFrom,
    sessionStore: new RollingSeedStore(resumeFrom, entries, options.storeRoot),
    entries,
    source: 'manual_body_recovery',
    diagnostic: seedDiagnostic(entries, {
      sourceSessionId: '',
      sourceEntryCount: 0,
      retainedEnvelopeCount: 0,
      bodyRestoredTurnCount: turns.length,
    }),
  }
}

export async function materializeRollingHistorySeed(seed: RollingHistorySeed | null): Promise<void> {
  if (!seed || seed.source === 'persisted') return
  if (!(seed.sessionStore instanceof RollingSeedStore)) {
    throw new Error('滚动 transcript 使用了未知的持久 store')
  }
  await seed.sessionStore.materialize(seed.resumeFrom)
  if (!seed.sessionStore.hasPersistedSession(seed.resumeFrom)) {
    throw new Error('滚动 transcript 持久化后无法重新打开')
  }
}

function claudeConfigRoot(override?: string): string {
  if (override) return override
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.'
  return process.env.CLAUDE_CONFIG_DIR?.trim() || `${homeDir}${path.sep}.claude`
}

async function nativeClaudeSessionFile(
  sessionId: string,
  cwd: string,
  claudeConfigDir?: string,
): Promise<string> {
  let canonicalCwd: string
  try {
    canonicalCwd = await realpath(cwd)
  } catch {
    canonicalCwd = path.resolve(cwd)
  }
  const projectKey = canonicalCwd.replace(/[^a-zA-Z0-9]/g, '-')
  // Agent SDK 对超长 key 还有一层私有 hash。与其猜错目录，不如明确停下；
  // Dashboard 的生产 cwd 很短（通常是 /app），不会命中这里。
  if (projectKey.length > 200) throw new Error('Claude 工作目录过长，无法安全生成原生 transcript 路径')
  return path.join(
    /*turbopackIgnore: true*/ claudeConfigRoot(claudeConfigDir),
    'projects',
    projectKey,
    `${sessionId}.jsonl`,
  )
}

/**
 * 把我们持久保存的滚动 transcript 放回 Claude Code 的原生会话目录。
 * 后续 query 只使用普通 resume，因此 CLI 继续读取真实 CLAUDE_CONFIG_DIR，
 * 不再进入 SDK 会删掉 refreshToken 的临时 SessionStore 配置目录。
 */
export async function materializeRollingNativeSession(
  seed: RollingHistorySeed | null,
  cwd: string,
  options: { claudeConfigDir?: string } = {},
): Promise<{ created: boolean; entryCount: number }> {
  if (!seed) return { created: false, entryCount: 0 }
  await materializeRollingHistorySeed(seed)
  const file = await nativeClaudeSessionFile(seed.resumeFrom, cwd, options.claudeConfigDir)
  const persistedEntries = seed.entries.length
    ? seed.entries
    : await seed.sessionStore.load({ projectKey: '', sessionId: seed.resumeFrom })
  if (existsSync(/*turbopackIgnore: true*/ file)) {
    // 正常情况下原生文件与持久副本一样新；若上次同步中途失败，只在持久
    // 副本明确包含更多完整记录时修复原生文件，避免反向覆盖更新的原生会话。
    const nativeEntryCount = (await readFile(/*turbopackIgnore: true*/ file, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean).length
    if (!persistedEntries?.length || nativeEntryCount >= persistedEntries.length) {
      return { created: false, entryCount: nativeEntryCount }
    }
  }
  if (!persistedEntries?.length) throw new Error('滚动 transcript 没有可恢复到 Claude 原生会话的内容')
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = path.join(
    /*turbopackIgnore: true*/ path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  )
  await writeFile(temp, `${persistedEntries.map(entry => JSON.stringify(entry)).join('\n')}\n`, {
    encoding: 'utf8', mode: 0o600,
  })
  await rename(temp, file)
  return { created: true, entryCount: persistedEntries.length }
}

type ImportLocalSession = (
  sessionId: string,
  store: SessionStore,
  options: { dir: string; includeSubagents: boolean },
) => Promise<void>

async function captureLocalTranscript(
  sessionId: string,
  cwd: string,
  importLocalSession: ImportLocalSession = importSessionToStore,
): Promise<SessionStoreEntry[] | null> {
  const capture = new CaptureSessionStore()
  try {
    await importLocalSession(sessionId, capture, { dir: cwd, includeSubagents: false })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    const message = (error as Error).message || String(error)
    if (/not found|no session|does not exist/i.test(message)) return null
    throw error
  }
  return capture.entries.length ? capture.entries : null
}

/** 成功一轮后，把 Claude 原生 transcript 原子同步回滚动持久存档。 */
export async function syncRollingNativeSession(
  sessionId: string,
  cwd: string,
  options: { storeRoot?: string; importLocalSession?: ImportLocalSession } = {},
): Promise<number> {
  const normalized = sessionId.trim()
  if (!normalized) throw new Error('滚动 transcript 同步缺少 Claude session id')
  const entries = await captureLocalTranscript(normalized, cwd, options.importLocalSession)
  if (!entries?.length) throw new Error('Claude 原生 transcript 不存在或为空，无法同步滚动存档')
  const store = new RollingSeedStore(normalized, [], options.storeRoot)
  await store.replace(normalized, entries)
  return entries.length
}

/** 同一 rolling revision 重部署：专用 store 缺失时，从 SDK 默认 transcript 原样补回。 */
export async function createRollingTranscriptRecoverySeed(
  sourceResumeFrom: string,
  options: {
    cwd: string
    storeRoot?: string
    importLocalSession?: ImportLocalSession
  },
): Promise<RollingHistorySeed | null> {
  const normalized = sourceResumeFrom.trim()
  if (!normalized) return null
  const entries = await captureLocalTranscript(normalized, options.cwd, options.importLocalSession)
  if (!entries) return null
  const envelopeCount = transcriptEnvelopes(entries).envelopes.length
  return {
    resumeFrom: normalized,
    sessionStore: new RollingSeedStore(normalized, entries, options.storeRoot),
    entries,
    source: 'legacy_transcript_recovery',
    diagnostic: seedDiagnostic(entries, {
      sourceSessionId: normalized,
      sourceEntryCount: entries.length,
      retainedEnvelopeCount: envelopeCount,
      bodyRestoredTurnCount: 0,
    }),
  }
}

/**
 * 新 revision 只按完整 Claude 轮次包裁剪旧 transcript。仍为 raw 的轮次保留
 * 原生 user/assistant/tool_use/tool_result 顺序；旧 transcript 中没有的 raw 轮次
 * 才从 Haven 降级恢复可见正文。
 */
export async function createRollingHistoryRevisionSeed(
  sourceResumeFrom: string,
  allTurns: HavenTurn[],
  rawTurns: HavenTurn[],
  options: Omit<TranscriptSeedOptions, 'sessionId'> & {
    storeRoot?: string
    requiredFullRawDays?: string[]
  },
): Promise<RollingHistorySeed | null> {
  const source = openRollingHistoryResume(sourceResumeFrom, options)
  if (!source) return null
  const sourceEntries = await source.sessionStore.load({ projectKey: '', sessionId: source.resumeFrom })
  if (!sourceEntries?.length) return null
  return createRevisionSeedFromEntries(
    sourceResumeFrom, sourceEntries, allTurns, rawTurns, options, 'revision_seed',
  )
}

async function createRevisionSeedFromEntries(
  sourceResumeFrom: string,
  sourceEntries: SessionStoreEntry[],
  allTurns: HavenTurn[],
  rawTurns: HavenTurn[],
  options: Omit<TranscriptSeedOptions, 'sessionId'> & {
    storeRoot?: string
    requiredFullRawDays?: string[]
  },
  sourceKind: 'revision_seed' | 'fixed_transcript_migration',
): Promise<RollingHistorySeed | null> {
  const { prefix, envelopes } = transcriptEnvelopes(sourceEntries)
  const aligned = alignEnvelopesToTurns(envelopes, allTurns)
  const nextSessionId = randomUUID()
  const selectedEntries: SessionStoreEntry[] = [...prefix]
  const requiredFullRawDays = new Set(options.requiredFullRawDays || [])
  const latestRawDay = [...new Set(rawTurns.map(turn => turn.chat_day || '').filter(Boolean))]
    .sort()
    .at(-1) || ''
  let retainedEnvelopeCount = 0
  let bodyRestoredTurnCount = 0
  let thinkingPrunedBlockCount = 0
  for (const turn of [...rawTurns].sort((a, b) => a.id - b.id)) {
    const envelope = aligned.get(turn.id)
    if (envelope) {
      retainedEnvelopeCount += 1
      const taggedEntries = envelope.entries.map(entry => ({
        ...entry,
        ob2HavenTurnId: turn.id,
        ob2ChatDay: turn.chat_day || '',
      }))
      if (turn.chat_day && turn.chat_day !== latestRawDay) {
        const pruned = pruneCompletedThinking(taggedEntries)
        thinkingPrunedBlockCount += pruned.removedBlockCount
        selectedEntries.push(...pruned.entries)
      } else {
        selectedEntries.push(...taggedEntries)
      }
    } else {
      if (requiredFullRawDays.has(turn.chat_day || '')) {
        throw new Error(`旧滚动 transcript 缺少仍为 raw 的完整轮次：${turn.chat_day || '未知日期'}，已停止本轮`)
      }
      bodyRestoredTurnCount += 1
      selectedEntries.push(...buildRollingTranscriptEntries([turn], {
        sessionId: nextSessionId,
        cwd: options.cwd,
        fallbackModel: options.fallbackModel,
      }).map(entry => ({
        ...entry,
        ob2RollingFidelity: 'body_restored',
        ob2HavenTurnId: turn.id,
        ob2ChatDay: turn.chat_day || '',
      })))
    }
  }
  if (selectedEntries.length === 0) return null
  const entries = cloneRollingTranscriptForSession(selectedEntries, nextSessionId)
  return {
    resumeFrom: nextSessionId,
    sessionStore: new RollingSeedStore(nextSessionId, entries, options.storeRoot),
    entries,
    source: sourceKind,
    diagnostic: seedDiagnostic(entries, {
      sourceSessionId: sourceResumeFrom,
      sourceEntryCount: sourceEntries.length,
      retainedEnvelopeCount,
      bodyRestoredTurnCount,
      thinkingPrunedBlockCount,
    }),
  }
}

/** 首次 fixed → rolling：通过 SDK 官方导入接口读取默认本地 transcript。 */
export async function createFixedTranscriptMigrationSeed(
  sourceResumeFrom: string,
  allTurns: HavenTurn[],
  rawTurns: HavenTurn[],
  options: Omit<TranscriptSeedOptions, 'sessionId'> & {
    storeRoot?: string
    requiredFullRawDays?: string[]
    importLocalSession?: ImportLocalSession
  },
): Promise<RollingHistorySeed | null> {
  const normalized = sourceResumeFrom.trim()
  if (!normalized) return null
  const entries = await captureLocalTranscript(normalized, options.cwd, options.importLocalSession)
  if (!entries) return null
  try {
    return await createRevisionSeedFromEntries(
      normalized, entries, allTurns, rawTurns, options, 'fixed_transcript_migration',
    )
  } catch (error) {
    const explicitlyAllowsBodyRestore = (options.requiredFullRawDays || []).length === 0
    const message = (error as Error).message || String(error)
    if (explicitlyAllowsBodyRestore && /完整轮次无法唯一对应|缺少仍为 raw 的完整轮次/.test(message)) {
      return null
    }
    throw error
  }
}

export const rollingHistoryTest = { transcriptEnvelopes, alignEnvelopesToTurns }
