import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { isClaudeSessionLimitNotice } from '@/app/lib/cc/subscriptionLimit'

export type DurableTurnOutcome = 'explicit_failure' | 'indeterminate'

export type TurnOutcomeRecord = {
  version: 1
  turnUuid: string
  requestId: string
  outcome: DurableTurnOutcome
  reason: string
  recordedAt: string
}

const CLAUDE_AUTH_FAILURE = /authentication_failed|failed to authenticate|oauth (?:access token|session) (?:has )?expired|could not be refreshed|re-authenticate to continue/i
const pendingWrites = new Map<string, Promise<void>>()

function outcomeStoreRoot(override?: string): string {
  if (override) return override
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.'
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim() || `${homeDir}${path.sep}.claude`
  return path.join(/*turbopackIgnore: true*/ claudeConfigDir, 'ob2-rolling-session-store-v1')
}

function outcomeFile(storeRoot?: string): string {
  return path.join(/*turbopackIgnore: true*/ outcomeStoreRoot(storeRoot), 'turn-outcomes-v1.jsonl')
}

export function isClaudeAuthenticationFailure(input: {
  error?: unknown
  text?: unknown
  apiErrorStatus?: unknown
  errors?: unknown
}): boolean {
  if (Number(input.apiErrorStatus) === 401) return true
  const combined = [
    input.error,
    input.text,
    ...(Array.isArray(input.errors) ? input.errors : [input.errors]),
  ].map(value => String(value || '')).join('\n')
  return CLAUDE_AUTH_FAILURE.test(combined)
}

/** Old transcripts predate the durable outcome ledger. New failures never rely on wording. */
export function isLegacyClaudeTerminalStatus(value: unknown): boolean {
  const text = String(value || '').trim()
  return isClaudeSessionLimitNotice(text) || isClaudeAuthenticationFailure({ text })
}

export async function recordTurnOutcome(input: {
  turnUuid: string
  requestId: string
  outcome: DurableTurnOutcome
  reason: string
  storeRoot?: string
}): Promise<void> {
  const turnUuid = input.turnUuid.trim()
  if (!turnUuid) return
  const file = outcomeFile(input.storeRoot)
  const record: TurnOutcomeRecord = {
    version: 1,
    turnUuid,
    requestId: input.requestId.trim(),
    outcome: input.outcome,
    reason: input.reason.trim().slice(0, 120),
    recordedAt: new Date().toISOString(),
  }
  const previous = pendingWrites.get(file) || Promise.resolve()
  const write = previous.then(async () => {
    await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
    await appendFile(/*turbopackIgnore: true*/ file, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8', mode: 0o600,
    })
  })
  pendingWrites.set(file, write)
  try {
    await write
  } finally {
    if (pendingWrites.get(file) === write) pendingWrites.delete(file)
  }
}

export async function loadTurnOutcomes(options: { storeRoot?: string } = {}): Promise<Map<string, TurnOutcomeRecord>> {
  let content = ''
  try {
    content = await readFile(/*turbopackIgnore: true*/ outcomeFile(options.storeRoot), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
  const outcomes = new Map<string, TurnOutcomeRecord>()
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line) as Partial<TurnOutcomeRecord>
      if (record.version !== 1 || typeof record.turnUuid !== 'string'
        || (record.outcome !== 'explicit_failure' && record.outcome !== 'indeterminate')) continue
      outcomes.set(record.turnUuid, {
        version: 1,
        turnUuid: record.turnUuid,
        requestId: typeof record.requestId === 'string' ? record.requestId : '',
        outcome: record.outcome,
        reason: typeof record.reason === 'string' ? record.reason : '',
        recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : '',
      })
    } catch {
      // A broken line cannot authorize deletion; missing evidence remains blocking.
    }
  }
  return outcomes
}
