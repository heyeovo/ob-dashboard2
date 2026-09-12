import { NextRequest } from 'next/server'
import { getSessionStats } from '@/app/lib/ccSession'
import { composeWindowPersonaAppend, loadRollingWindowAppend } from '@/app/lib/cc/windowPrompt'
import { inspectRollingHistoryTranscript } from '@/app/lib/cc/rollingHistory'
import { getConversationSession, listTurns, type HavenTurn } from '@/app/lib/havenTurns'
import { buildPersonaAppend, getPersona, promptModulesForPersona } from '@/app/lib/havenPersonas'
import { systemPromptContentHash } from '@/app/lib/cc/ccOptions'
import { readSystemPromptAudit } from '@/app/lib/cc/systemPromptAudit'

export const runtime = 'nodejs'

function rawRecord(rawJson: string | undefined): Record<string, unknown> {
  if (!rawJson) return {}
  try {
    const parsed = JSON.parse(rawJson)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pickFields(value: unknown, fields: string[]): Record<string, unknown> | null {
  const source = objectValue(value)
  if (!source) return null
  return Object.fromEntries(fields.filter(field => source[field] !== undefined).map(field => [field, source[field]]))
}

function auditMessages(turns: HavenTurn[]) {
  return turns.flatMap(turn => {
    const base = {
      turn_id: turn.id,
      round_id: turn.round_id,
      day: turn.chat_day || '',
      created_at: turn.created_at,
      turn_kind: turn.turn_kind || 'user',
    }
    const userText = turn.user_text.trim()
    const assistantText = turn.assistant_text.trim()
    return [
      ...(userText ? [{ ...base, id: turn.user_message_id || `turn-${turn.id}-user`, role: 'user', content: userText, chars: userText.length }] : []),
      ...(assistantText ? [{ ...base, id: turn.assistant_message_id || `turn-${turn.id}-assistant`, role: 'assistant', content: assistantText, chars: assistantText.length }] : []),
    ]
  })
}

function matchTranscriptMessages(
  source: ReturnType<typeof auditMessages>,
  transcript: Awaited<ReturnType<typeof inspectRollingHistoryTranscript>>,
): number {
  if (!transcript) return 0
  const available = transcript.messages.map(message => ({ ...message, used: false }))
  let matched = 0
  for (const message of source) {
    const candidate = available.find(item => !item.used
      && item.role === message.role
      && item.content.includes(message.content))
    if (candidate) {
      matched += 1
      candidate.used = true
    }
  }
  return matched
}

export async function GET(request: NextRequest) {
  const sessionId = (request.nextUrl.searchParams.get('session_id') || '').trim()
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })

  const sessionResult = await getConversationSession(sessionId, { includeContextDays: true })
  if (!sessionResult.ok) {
    return Response.json({ ok: false, error: sessionResult.error || '读不到会话配置' }, { status: 502 })
  }
  if (!sessionResult.found || !sessionResult.session) {
    return Response.json({ ok: false, error: '找不到这个会话' }, { status: 404 })
  }

  try {
    const session = sessionResult.session
    const [rolling, latestResult] = await Promise.all([
      loadRollingWindowAppend(sessionId, session, sessionResult.contextDays, { logDiagnostics: false }),
      listTurns(sessionId, { limit: 50, includeRaw: true }),
    ])
    const latestTurn = latestResult.ok ? latestResult.turns.at(-1) : undefined
    const latestRaw = rawRecord(latestTurn?.raw_json)
    const rollingSeedRaw = latestResult.ok
      ? [...latestResult.turns].reverse()
        .map(turn => objectValue(rawRecord(turn.raw_json).rolling_seed))
        .find(Boolean) || null
      : null
    const latestCacheRaw = objectValue(latestRaw.cache_diagnostic)
    const usage = pickFields(latestRaw.usage, [
      'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',
      'cacheWrite1hTokens', 'cacheWrite5mTokens', 'durationMs', 'tokensPerSec', 'costUsd',
    ])
    const cacheDiagnostic = pickFields(latestCacheRaw, [
      'turn_kind', 'lane', 'iterator', 'iterator_created_at', 'model_request_started_at',
      'system_hash', 'tools_hash', 'mcp_hash', 'options_hash', 'tool_names', 'mcp_server_names',
    ])
    const modes = session.rolling_context?.day_modes || {}
    const messages = auditMessages(rolling.history)
    const stats = getSessionStats(sessionId)
    const transcriptSessionId = String(latestCacheRaw?.cc_session_id || latestCacheRaw?.resume_hint || stats.ccSessionId || '')
    const transcript = transcriptSessionId
      ? await inspectRollingHistoryTranscript(transcriptSessionId)
      : null
    const personaResult = await getPersona(session.persona_id)
    const persona = personaResult.persona
    const currentDashboardAppend = composeWindowPersonaAppend(
      buildPersonaAppend(persona, session.prompt_module_overrides),
      session,
      sessionId,
      rolling.content,
    )
    const currentSystemHash = systemPromptContentHash(session.mode, currentDashboardAppend)
    const storedSystemPrompt = await readSystemPromptAudit(sessionId)
    const latestSystemHash = String(storedSystemPrompt?.systemHash || latestCacheRaw?.system_hash || '')
    const storedLatestAppend = storedSystemPrompt?.dashboardAppend || ''
    const latestAppend = storedLatestAppend || (latestSystemHash === currentSystemHash ? currentDashboardAppend : '')

    return Response.json({
      ok: true,
      session_id: sessionId,
      title: session.title || sessionId,
      strategy: session.rolling_context?.strategy || 'fixed_window',
      context_revision: session.context_revision,
      timezone: session.rolling_context?.timezone || '',
      day_start_hour: session.rolling_context?.day_start_hour ?? 0,
      days: sessionResult.contextDays.map(day => ({
        day: day.day,
        mode: modes[day.day] || 'raw',
        turn_count: day.turn_count,
        raw_chars: day.raw_chars,
        review_chars: day.review?.chars || 0,
      })),
      rolling: {
        turn_count: rolling.history.length,
        message_count: messages.length,
        char_count: messages.reduce((sum, message) => sum + message.chars, 0),
        messages,
        background_content: rolling.content,
        pinned_bucket_ids: rolling.pinnedBucketIds,
        selected_journal_ids: session.rolling_context?.selected_journal_ids || [],
      },
      transcript: transcript ? {
        available: true,
        entry_count: transcript.entryCount,
        message_count: transcript.messages.length,
        matched_source_messages: matchTranscriptMessages(messages, transcript),
        expected_source_messages: messages.length,
        rolling_wrapper_messages: transcript.messages.filter(message => message.containsRollingWindowContext).length,
        memory_recall_messages: transcript.messages.filter(message => message.containsMemoryRecall).length,
        tool_use_messages: transcript.messages.filter(message => message.blockTypes.includes('tool_use')).length,
        tool_result_messages: transcript.messages.filter(message => message.blockTypes.includes('tool_result')).length,
        body_restored_messages: transcript.messages.filter(message => message.bodyRestored).length,
        messages: transcript.messages,
      } : {
        available: false,
        entry_count: 0,
        message_count: 0,
        matched_source_messages: 0,
        expected_source_messages: messages.length,
        rolling_wrapper_messages: 0,
        memory_recall_messages: 0,
        tool_use_messages: 0,
        tool_result_messages: 0,
        body_restored_messages: 0,
        messages: [],
      },
      rolling_seed: rollingSeedRaw,
      system_prompt: {
        current: {
          mode: session.mode,
          sdk_shape: session.mode === 'chat' ? 'custom' : 'claude_code_preset_append',
          system_hash: currentSystemHash,
          dashboard_append: currentDashboardAppend,
          chars: currentDashboardAppend.length,
          modules: promptModulesForPersona(persona).map(module => ({
            id: module.id,
            name: module.name,
            enabled: session.prompt_module_overrides[module.id] ?? module.enabled_by_default,
            chars: module.content.length,
          })),
        },
        latest: {
          available: Boolean(latestAppend),
          source: storedLatestAppend ? 'stored_snapshot' : latestAppend ? 'current_hash_match' : 'unavailable',
          request_id: storedSystemPrompt?.requestId || '',
          recorded_at: storedSystemPrompt?.recordedAt || '',
          mode: String(storedSystemPrompt?.mode || session.mode),
          sdk_shape: String(storedSystemPrompt?.sdkShape || (session.mode === 'chat' ? 'custom' : 'claude_code_preset_append')),
          system_hash: latestSystemHash,
          dashboard_append: latestAppend,
          chars: latestAppend.length,
        },
        hash_match: Boolean(latestSystemHash && latestSystemHash === currentSystemHash),
      },
      latest: {
        turn_id: latestTurn?.id || null,
        created_at: latestTurn?.created_at || '',
        rolling_context_revision: Number(latestRaw.rolling_context_revision || 0),
        usage,
        cache_diagnostic: cacheDiagnostic,
      },
      stats,
      at: Date.now(),
    })
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || '上下文审计读取失败' },
      { status: 502 },
    )
  }
}
