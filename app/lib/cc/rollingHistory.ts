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
import type { ArchiveDayAudit } from './rollingArchive'
import { isClaudeSessionLimitNotice } from '@/app/lib/cc/subscriptionLimit'
import { beijingRuntimeContext } from '@/app/lib/runtimeContext'

export type RollingHistorySeed = {
  resumeFrom: string
  sessionStore: SessionStore
  entries: SessionStoreEntry[]
  source: 'new_seed' | 'manual_body_recovery' | 'archive_seed' | 'model_surface_rebase' | 'persisted'
  diagnostic?: RollingSeedDiagnostic
}

const SYSTEM_REMINDER_BLOCK = /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi

/**
 * 原生 transcript 里的 SDK 控制提醒属于当时的 request prefix，不是对话事实。
 * rebase 时移除 SDK system 控制记录，并从 user 文本剥离 reminder 块；assistant、
 * thinking、tool_use/tool_result 和其余 user 正文全部保留。原 transcript 永远不原地修改。
 */
export function stripStaleSystemReminders(entries: SessionStoreEntry[]): {
  entries: SessionStoreEntry[]
  removedBlockCount: number
} {
  let removedBlockCount = 0
  const stripText = (value: string) => {
    const next = value.replace(SYSTEM_REMINDER_BLOCK, () => {
      removedBlockCount += 1
      return ''
    })
    return next === value ? value : next.trim()
  }

  const cleaned = entries.flatMap(entry => {
    const cloned = JSON.parse(JSON.stringify(entry)) as SessionStoreEntry
    const attachment = cloned.attachment as { type?: string } | undefined
    if (cloned.type === 'system' || (cloned.type === 'attachment'
      && ['environment', 'model', 'total_tokens_reminder', 'date'].includes(attachment?.type || ''))) {
      removedBlockCount += 1
      return []
    }
    const message = messageRecord(cloned)
    if (message?.role !== 'user') return [cloned]
    if (typeof message.content === 'string') {
      message.content = stripText(message.content)
      return message.content ? [cloned] : []
    }
    if (!Array.isArray(message.content)) return [cloned]
    const cleanedContent = message.content.flatMap(block => {
      if (!block || typeof block !== 'object') return [block]
      const record = block as Record<string, unknown>
      if (record.type !== 'text' || typeof record.text !== 'string') return [block]
      const text = stripText(record.text)
      return text ? [{ ...record, text }] : []
    })
    message.content = cleanedContent
    return cleanedContent.length ? [cloned] : []
  })
  return { entries: cleaned, removedBlockCount }
}

export type RollingSeedDiagnostic = {
  sourceSessionId: string
  sourceEntryCount: number
  retainedEnvelopeCount: number
  bodyRestoredTurnCount: number
  thinkingPrunedBlockCount: number
  memoryRecallPrunedBlockCount: number
  attachmentPrunedBlockCount?: number
  days?: ArchiveDayAudit[]
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

export type TranscriptEnvelope = { entries: SessionStoreEntry[]; timestamp: string }

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
      ob2ChatDay: turn.chat_day || '',
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
      ob2ChatDay: turn.chat_day || '',
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
    if (isAgentWakeLimitTurn(turn)) continue
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

export function rollingStoreRoot(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.'
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim() || `${homeDir}${path.sep}.claude`
  return path.join(/*turbopackIgnore: true*/ claudeConfigDir, 'ob2-rolling-session-store-v1')
}

function encodedPart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url') || 'main'
}

export class RollingSeedStore implements SessionStore {
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

export function seedDiagnostic(entries: SessionStoreEntry[], overrides: Partial<RollingSeedDiagnostic>): RollingSeedDiagnostic {
  const messages = entries.map(entry => messageRecord(entry))
  return {
    sourceSessionId: '',
    sourceEntryCount: 0,
    retainedEnvelopeCount: 0,
    bodyRestoredTurnCount: 0,
    thinkingPrunedBlockCount: 0,
    memoryRecallPrunedBlockCount: 0,
    toolUseCount: messages.reduce((sum, message) => sum + entryBlockTypes(message).filter(type => type === 'tool_use').length, 0),
    toolResultCount: messages.reduce((sum, message) => sum + entryBlockTypes(message).filter(type => type === 'tool_result').length, 0),
    memoryRecallCount: messages.filter(message => /<记忆召回>|<之前的记忆>|<memory_card\b/i.test(transcriptMessageContent(message))).length,
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

export function pruneCompletedThinking(entries: SessionStoreEntry[]): {
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

const MEMORY_RECALL_BLOCKS = [
  /<记忆召回[^>]*>[\s\S]*?<\/记忆召回>/gi,
  /<之前的记忆[^>]*>[\s\S]*?<\/之前的记忆>/gi,
  /<memory_card\b[^>]*>[\s\S]*?<\/memory_card>/gi,
]

/**
 * 旧日期的动态召回已经可从 Haven 重新获取，重建时直接从 user
 * 文本删掉。不留“已清理”占位符；真实用户正文和末尾时间戳保留。
 */
export function prunePersistedRecall(entries: SessionStoreEntry[]): {
  entries: SessionStoreEntry[]
  removedBlockCount: number
} {
  let removedBlockCount = 0
  const stripText = (value: string) => {
    let next = value
    for (const pattern of MEMORY_RECALL_BLOCKS) {
      next = next.replace(pattern, () => {
        removedBlockCount += 1
        return ''
      })
    }
    return next === value ? value : next.replace(/\n{3,}/g, '\n\n').trim()
  }

  const prunedEntries = entries.flatMap(entry => {
    const cloned = JSON.parse(JSON.stringify(entry)) as SessionStoreEntry
    const message = messageRecord(cloned)
    if (message?.role !== 'user' || !isPrimaryUserEntry(cloned)) return [cloned]
    if (typeof message.content === 'string') {
      message.content = stripText(message.content)
      return message.content ? [cloned] : []
    }
    if (!Array.isArray(message.content)) return [cloned]
    const content = message.content.flatMap(block => {
      if (!block || typeof block !== 'object') return [block]
      const record = block as Record<string, unknown>
      if (record.type !== 'text' || typeof record.text !== 'string') return [block]
      const text = stripText(record.text)
      return text ? [{ ...record, text }] : []
    })
    message.content = content
    return content.length ? [cloned] : []
  })
  return { entries: prunedEntries, removedBlockCount }
}

function isPrimaryUserEntry(entry: SessionStoreEntry): boolean {
  const message = messageRecord(entry)
  if (entry.type !== 'user' || message?.role !== 'user') return false
  const blocks = contentBlocks(message)
  return !blocks.some(block => block.type === 'tool_result')
}

const NO_VISIBLE_OUTPUT_CONTINUATION = '[Your previous response had no visible output. Please continue and produce a user-visible response.]'
const INTERRUPTED_REQUEST_MARKER = '[Request interrupted by user]'
const CONTINUE_INTERRUPTED_REQUEST = 'Continue from where you left off.'

function isInternalContinuationEntry(entry: SessionStoreEntry, current: SessionStoreEntry[]): boolean {
  if (!isPrimaryUserEntry(entry)) return false
  const content = transcriptMessageContent(messageRecord(entry)).trim()
  if (content === INTERRUPTED_REQUEST_MARKER) return true
  if (content === CONTINUE_INTERRUPTED_REQUEST || content.startsWith('Your response above was cut off')) return true
  if (content === NO_VISIBLE_OUTPUT_CONTINUATION) {
    return current.some(previous => {
      const message = messageRecord(previous)
      return message?.role === 'assistant'
        || (message ? contentBlocks(message).some(block => block.type === 'tool_result') : false)
    })
  }
  return false
}

export function transcriptEnvelopes(entries: SessionStoreEntry[]): {
  prefix: SessionStoreEntry[]
  envelopes: TranscriptEnvelope[]
} {
  const prefix: SessionStoreEntry[] = []
  const envelopes: TranscriptEnvelope[] = []
  let current: SessionStoreEntry[] | null = null
  for (const entry of entries) {
    if (isPrimaryUserEntry(entry) && !(current && isInternalContinuationEntry(entry, current))) {
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
  return { entries, timestamp: typeof primaryUser?.timestamp === 'string' ? primaryUser.timestamp : '' }
}

function isAgentWakeLimitTurn(turn: HavenTurn): boolean {
  return turn.turn_kind === 'agent_wake' && !turn.user_text.trim()
    && isClaudeSessionLimitNotice(turn.assistant_text)
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
      containsMemoryRecall: /<记忆召回>|<之前的记忆>|<memory_card\b/i.test(content),
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

export async function nativeClaudeSessionFile(
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

export type ImportLocalSession = (
  sessionId: string,
  store: SessionStore,
  options: { dir: string; includeSubagents: boolean },
) => Promise<void>

export async function captureLocalTranscript(
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

/**
 * 模型可见配置变化时，把旧原生 transcript 复制成一个新 session。旧 SDK
 * system-reminder 会被剥离，当前 query 启动后由 SDK 按最新配置重新注入。
 */
export async function createModelSurfaceRebaseSeed(
  sourceResumeFrom: string,
  options: {
    cwd: string
    storeRoot?: string
    importLocalSession?: ImportLocalSession
  },
): Promise<RollingHistorySeed | null> {
  const normalized = sourceResumeFrom.trim()
  if (!normalized) return null
  let sourceEntries = await captureLocalTranscript(normalized, options.cwd, options.importLocalSession)
  if (!sourceEntries?.length) {
    const persisted = openRollingHistoryResume(normalized, options)
    sourceEntries = persisted
      ? await persisted.sessionStore.load({ projectKey: '', sessionId: persisted.resumeFrom })
      : null
  }
  if (!sourceEntries?.length) return null
  const stripped = stripStaleSystemReminders(sourceEntries)
  if (!stripped.entries.length) return null
  const nextSessionId = randomUUID()
  const entries = cloneRollingTranscriptForSession(stripped.entries, nextSessionId)
  const envelopeCount = transcriptEnvelopes(entries).envelopes.length
  return {
    resumeFrom: nextSessionId,
    sessionStore: new RollingSeedStore(nextSessionId, entries, options.storeRoot),
    entries,
    source: 'model_surface_rebase',
    diagnostic: seedDiagnostic(entries, {
      sourceSessionId: normalized,
      sourceEntryCount: sourceEntries.length,
      retainedEnvelopeCount: envelopeCount,
      bodyRestoredTurnCount: 0,
      thinkingPrunedBlockCount: 0,
      memoryRecallPrunedBlockCount: 0,
    }),
  }
}
