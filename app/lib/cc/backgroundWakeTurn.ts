import { randomUUID } from 'node:crypto'
import { hasPending } from '@/app/lib/ccChannel'
import { peekSession } from '@/app/lib/ccSession'
import { runTurn, type RunTurnResult } from '@/app/lib/cc/runTurn'
import { loadBackgroundTurnInputs } from '@/app/lib/cc/turnInputs'
import { recordTurnStrict } from '@/app/lib/havenTurns'
import { AGENT_WAKE_NOOP_MARKER } from '@/app/lib/cc/agentWakeTool'
import { buildDisplaySegments } from '@/app/lib/cc/displaySegments'
import {
  tryRunBackgroundSessionTurn,
  type BackgroundTurnDeferredReason,
} from '@/app/lib/cc/sessionTurnCoordinator'

export type BackgroundWakeCause = 'cache_keepalive' | 'agent_schedule' | 'conversation_silence'

export type BackgroundWakeInput = {
  sessionId: string
  wakeId?: string
  at: string
  cause: BackgroundWakeCause
  reason?: string
  signal?: AbortSignal
}

export type BackgroundWakeResult =
  | { status: 'completed'; turn: RunTurnResult; laneId: string }
  | { status: 'deferred'; reason: BackgroundTurnDeferredReason }
  | { status: 'failed'; error: string }

function wakePrompt(input: BackgroundWakeInput, wakeId: string): string {
  const attributes = [
    'v="1"',
    `id=${JSON.stringify(wakeId)}`,
    `at=${JSON.stringify(input.at)}`,
    `cause=${JSON.stringify(input.cause)}`,
    input.reason ? `reason=${JSON.stringify(input.reason)}` : '',
  ].filter(Boolean)
  return `<agent_wake ${attributes.join(' ')}/>`
}

/** Programmatic runner only. Phase 4 will provide the Haven scheduler callback. */
export async function runBackgroundWake(input: BackgroundWakeInput): Promise<BackgroundWakeResult> {
  const sessionId = input.sessionId.trim()
  if (!sessionId) return { status: 'failed', error: 'sessionId 为空' }
  try {
    const loaded = await loadBackgroundTurnInputs(sessionId)
    const blocked = () => {
      const live = peekSession(sessionId)
      return Boolean(hasPending(sessionId) || live?.busy || live?.compacting)
    }
    const wakeId = input.wakeId?.trim() || randomUUID()
    const result = await tryRunBackgroundSessionTurn(
      sessionId,
      () => runTurn({
        sessionId,
        requestId: wakeId,
        expectedLastRoundId: 0,
        personaId: loaded.persona.id,
        text: wakePrompt(input, wakeId),
        persona: loaded.persona,
        config: loaded.config,
        sessionSnapshot: loaded.sessionSnapshot,
        resumeHint: loaded.resumeHint,
        turnKind: 'agent_wake',
        persistTurn: false,
        signal: input.signal || new AbortController().signal,
        send: () => undefined,
        close: () => undefined,
      }),
      blocked,
    )
    if (result.status === 'deferred') return result
    if (!result.value.ok) return { status: 'failed', error: result.value.error || '后台 wake 失败' }
    const assistantText = result.value.assistantText?.trim() === AGENT_WAKE_NOOP_MARKER
      ? ''
      : result.value.assistantText || ''
    const session = loaded.sessionSnapshot.session
    if (!session) return { status: 'failed', error: 'Haven 返回空窗口' }
    const persisted = await recordTurnStrict({
      sessionId,
      requestId: wakeId,
      expectedLastRoundId: Number(session.cc_seen_round_id || 0),
      personaId: loaded.persona.id,
      userText: '',
      assistantText,
      model: loaded.config.model,
      client: `ob2-chat/${loaded.persona.id}`,
      route: '/api/cc-agent-wake',
      source: 'cc',
      turnKind: 'agent_wake',
      laneId: loaded.laneId,
      raw: {
        version: 1,
        engine: 'cc',
        cred_mode: loaded.config.cred,
        cc_lane_id: loaded.laneId,
        model: loaded.config.model,
        persona_id: loaded.persona.id,
        usage: result.value.usage || undefined,
        display_segments: assistantText
          ? result.value.displaySegments || buildDisplaySegments(assistantText)
          : buildDisplaySegments(''),
      },
      agentWakeUpdate: {
        model_activity_at: result.value.modelActivityAt
          ? new Date(result.value.modelActivityAt).toISOString()
          : input.at,
        cache_refresh_at: result.value.cacheRefreshAt
          ? new Date(result.value.cacheRefreshAt).toISOString()
          : '',
        wake_cause: input.cause,
        agent_wake: {
          wake_id: wakeId,
          cause: input.cause,
          at: input.at,
          reason: input.reason || '',
        },
        wake_decision: result.value.wakeDecision || undefined,
      },
      signal: input.signal,
    })
    if (!persisted.ok || !persisted.stored) {
      return { status: 'failed', error: persisted.error || '后台 wake 未保存到 Haven' }
    }
    return {
      status: 'completed',
      turn: { ...result.value, assistantText, displaySegments: buildDisplaySegments(assistantText) },
      laneId: loaded.laneId,
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : '后台 wake 失败' }
  }
}
