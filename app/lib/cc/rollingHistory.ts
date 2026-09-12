import { randomUUID } from 'node:crypto'
import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import type { HavenTurn } from '@/app/lib/havenTurns'

export type RollingHistorySeed = {
  resumeFrom: string
  sessionStore: SessionStore
  entries: SessionStoreEntry[]
}

type TranscriptSeedOptions = {
  sessionId: string
  cwd: string
  fallbackModel: string
}

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
      message: { role: 'user', content },
    })
    parentUuid = uuid
  }

  const pushAssistant = (content: string, timestamp: string, model: string) => {
    const uuid = randomUUID()
    entries.push({
      type: 'assistant', uuid, parentUuid, timestamp,
      sessionId: options.sessionId, cwd: options.cwd,
      isSidechain: false,
      message: {
        id: `msg_rolling_${uuid.replace(/-/g, '')}`,
        type: 'message', role: 'assistant',
        model: model || options.fallbackModel || 'claude',
        content: [{ type: 'text', text: content }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
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

class RollingSeedStore implements SessionStore {
  private readonly sessions = new Map<string, SessionStoreEntry[]>()

  constructor(sessionId: string, entries: SessionStoreEntry[]) {
    this.sessions.set(this.key({ projectKey: '', sessionId }), [...entries])
  }

  private key(key: SessionKey): string {
    return `${key.sessionId}::${key.subpath || ''}`
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const storageKey = this.key(key)
    const current = this.sessions.get(storageKey) || []
    current.push(...entries)
    this.sessions.set(storageKey, current)
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const entries = this.sessions.get(this.key(key))
    return entries ? [...entries] : null
  }
}

export function createRollingHistorySeed(
  turns: HavenTurn[],
  options: Omit<TranscriptSeedOptions, 'sessionId'>,
): RollingHistorySeed | null {
  if (turns.length === 0) return null
  const resumeFrom = randomUUID()
  const entries = buildRollingTranscriptEntries(turns, { ...options, sessionId: resumeFrom })
  if (entries.length === 0) return null
  return { resumeFrom, sessionStore: new RollingSeedStore(resumeFrom, entries), entries }
}
