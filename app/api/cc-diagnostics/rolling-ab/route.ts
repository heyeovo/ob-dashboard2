import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk'
import { loadBackgroundTurnInputs } from '@/app/lib/cc/turnInputs'
import { buildCcOptions } from '@/app/lib/cc/ccOptions'
import {
  cloneRollingTranscriptForSession,
  openRollingHistoryResume,
} from '@/app/lib/cc/rollingHistory'

export const runtime = 'nodejs'
export const maxDuration = 240

type ProbeResult = {
  probe: 'fresh' | 'rolling_session_store_resume'
  ok: boolean
  elapsed_ms: number
  claude_code_version: string
  sdk_session_id: string
  assistant_error: string
  api_error_status: number | null
  terminal_reason: string
  result_subtype: string
  expected_reply_seen: boolean
  query_closed: boolean
  thrown_error: string
}

class MemorySessionStore implements SessionStore {
  private entries: SessionStoreEntry[]

  constructor(entries: SessionStoreEntry[]) {
    this.entries = structuredClone(entries)
  }

  async append(_key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    this.entries.push(...structuredClone(entries))
  }

  async load(): Promise<SessionStoreEntry[] | null> {
    return structuredClone(this.entries)
  }
}

function bearer(request: Request): string {
  const value = request.headers.get('authorization') || ''
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''
}

function secureMatch(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function credentialFingerprint(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.'
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDir, '.claude')
  try {
    return createHash('sha256')
      .update(readFileSync(path.join(configDir, '.credentials.json')))
      .digest('hex')
      .slice(0, 16)
  } catch {
    return 'missing'
  }
}

async function* promptOnce(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: 'Diagnostic request. Reply with exactly: AB_OK' },
    parent_tool_use_id: null,
    uuid: randomUUID(),
  }
}

function safeError(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

async function runProbe(
  probe: ProbeResult['probe'],
  options: Options,
): Promise<ProbeResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  let q: Query | null = null
  const result: ProbeResult = {
    probe,
    ok: false,
    elapsed_ms: 0,
    claude_code_version: '',
    sdk_session_id: '',
    assistant_error: '',
    api_error_status: null,
    terminal_reason: '',
    result_subtype: '',
    expected_reply_seen: false,
    query_closed: false,
    thrown_error: '',
  }
  try {
    q = query({
      prompt: promptOnce(),
      options: {
        ...options,
        abortController: controller,
        maxTurns: 1,
      },
    })
    for await (const raw of q) {
      const msg = raw as SDKMessage
      if (msg.type === 'system' && msg.subtype === 'init') {
        result.claude_code_version = msg.claude_code_version
        result.sdk_session_id = msg.session_id
      } else if (msg.type === 'assistant') {
        result.assistant_error = String(msg.error || '')
        result.expected_reply_seen ||= msg.message.content.some(
          block => block.type === 'text' && block.text.trim() === 'AB_OK',
        )
      } else if (msg.type === 'result') {
        const resultMessage = msg as SDKMessage & { api_error_status?: number | null }
        result.result_subtype = String(msg.subtype || '')
        result.terminal_reason = String(msg.terminal_reason || '')
        result.api_error_status = resultMessage.api_error_status ?? null
        result.ok = !msg.is_error && msg.subtype === 'success' && !result.assistant_error
        break
      }
    }
  } catch (error) {
    result.thrown_error = safeError(error instanceof Error ? error.message : error)
  } finally {
    clearTimeout(timer)
    try {
      q?.close()
      result.query_closed = Boolean(q)
    } catch (error) {
      result.thrown_error ||= `close_failed:${safeError(error instanceof Error ? error.message : error)}`
    }
    result.elapsed_ms = Date.now() - startedAt
  }
  return result
}

export async function POST(request: Request) {
  const expected = process.env.OMBRE_AGENT_WAKE_RUNNER_TOKEN?.trim() || ''
  if (!expected) return Response.json({ ok: false, error: 'diagnostic_not_configured' }, { status: 503 })
  if (!secureMatch(bearer(request), expected)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const sessionId = String(body.session_id || '').trim()
  if (!sessionId || sessionId.length > 200) {
    return Response.json({ ok: false, error: 'invalid_session_id' }, { status: 400 })
  }

  try {
    const loaded = await loadBackgroundTurnInputs(sessionId)
    if (loaded.config.cred !== 'subscription') {
      return Response.json({ ok: false, error: 'target_lane_is_not_subscription' }, { status: 409 })
    }
    if (!loaded.config.rollingHistory || !loaded.resumeHint) {
      return Response.json({ ok: false, error: 'target_is_not_resumable_rolling_session' }, { status: 409 })
    }
    const source = openRollingHistoryResume(loaded.resumeHint)
    if (!source) {
      return Response.json({ ok: false, error: 'rolling_session_store_not_found' }, { status: 409 })
    }
    const sourceEntries = await source.sessionStore.load({
      projectKey: '',
      sessionId: source.resumeFrom,
    })
    if (!sourceEntries?.length) {
      return Response.json({ ok: false, error: 'rolling_session_store_is_empty' }, { status: 409 })
    }

    const fingerprintBefore = credentialFingerprint()
    const freshOptions = buildCcOptions(loaded.config, null)
    const fresh = await runProbe('fresh', {
      ...freshOptions,
      persistSession: false,
      tools: [],
      allowedTools: [],
      disallowedTools: [],
      mcpServers: {},
      hooks: {},
      enableFileCheckpointing: false,
    })

    const diagnosticSessionId = randomUUID()
    const diagnosticEntries = cloneRollingTranscriptForSession(sourceEntries, diagnosticSessionId)
    const rollingOptions = buildCcOptions(loaded.config, diagnosticSessionId)
    const rolling = await runProbe('rolling_session_store_resume', {
      ...rollingOptions,
      sessionStore: new MemorySessionStore(diagnosticEntries),
      enableFileCheckpointing: false,
    })
    const fingerprintAfter = credentialFingerprint()

    return Response.json({
      ok: fresh.ok && rolling.ok,
      target: {
        session_id: sessionId,
        lane_id: loaded.laneId,
        context_revision: loaded.config.contextRevision,
        source_entry_count: sourceEntries.length,
        source_resume_id_hash: createHash('sha256').update(source.resumeFrom).digest('hex').slice(0, 16),
      },
      credential: {
        fingerprint_before: fingerprintBefore,
        fingerprint_after: fingerprintAfter,
        changed_during_probe: fingerprintBefore !== fingerprintAfter,
      },
      probes: [fresh, rolling],
    })
  } catch (error) {
    return Response.json({
      ok: false,
      error: safeError(error instanceof Error ? error.message : error),
    }, { status: 500 })
  }
}
