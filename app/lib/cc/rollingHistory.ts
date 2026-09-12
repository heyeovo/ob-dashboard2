import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import type { HavenTurn } from '@/app/lib/havenTurns'

export type RollingHistorySeed = {
  resumeFrom: string
  sessionStore: SessionStore
  entries: SessionStoreEntry[]
  source: 'new_seed' | 'persisted'
}

type TranscriptSeedOptions = {
  sessionId: string
  cwd: string
  fallbackModel: string
}

// 与 package.json 固定的 @anthropic-ai/claude-agent-sdk 0.3.220 对应。
const CLAUDE_CODE_VERSION = '2.1.220'

function wakeInput(turn: HavenTurn): string {
  let cause = 'agent_schedule'
  let reason = ''
  if (turn.raw_json) {
    try {
      const raw = JSON.parse(turn.raw_json) as Record<string, unknown>
      const wake = raw.agent_wake && typeof raw.agent_wake === 'object'
        ? raw.agent_wake as Record<string, unknown>
        : null
      if (wake) {
        cause = String(wake.cause || cause)
        reason = String(wake.reason || '')
      }
    } catch {
      // 旧记录没有可解析的 raw_json 时，仍保留“系统唤醒”语义。
    }
  }
  const attributes = [
    `cause=${JSON.stringify(cause)}`,
    reason ? `reason=${JSON.stringify(reason)}` : '',
  ].filter(Boolean)
  return `<agent_wake ${attributes.join(' ')}/>`
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

  const pushUser = (content: string, timestamp: string) => {
    const uuid = randomUUID()
    entries.push({
      type: 'user', uuid, parentUuid, timestamp,
      sessionId: options.sessionId, cwd: options.cwd,
      isSidechain: false, userType: 'external',
      version: CLAUDE_CODE_VERSION, gitBranch: 'HEAD',
      permissionMode: 'default', promptSource: 'sdk', entrypoint: 'sdk-ts',
      promptId: randomUUID(),
      message: { role: 'user', content },
    })
    parentUuid = uuid
  }

  const pushAssistant = (content: string, timestamp: string, model: string) => {
    const uuid = randomUUID()
    entries.push({
      type: 'assistant', uuid, parentUuid, timestamp,
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
      pushUser(wakeInput(turn), turn.created_at)
      pushAssistant(assistantText, turn.created_at, turn.model)
      continue
    }
    if (userText) pushUser(userText, turn.created_at)
    if (assistantText) {
      if (!userText) pushUser('<system_generated_turn source="restored_history"/>', turn.created_at)
      pushAssistant(assistantText, turn.created_at, turn.model)
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
  }
}
