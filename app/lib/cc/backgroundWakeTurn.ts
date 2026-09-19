import { randomUUID } from 'node:crypto'
import { hasPending } from '@/app/lib/ccChannel'
import { peekSession } from '@/app/lib/ccSession'
import { runTurn, type RunTurnResult } from '@/app/lib/cc/runTurn'
import { loadBackgroundTurnInputs } from '@/app/lib/cc/turnInputs'
import { beginAgentWakeRun, getTurnByRequestId, patchAgentWakeSchedule, recordTurnStrict } from '@/app/lib/havenTurns'
import { parseAgentWakeNoop } from '@/app/lib/cc/agentWakeTool'
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
  laneId?: string
  scheduleVersion?: number
  leaseOwner?: string
  silenceSourceTurnId?: number
  signal?: AbortSignal
}

export type BackgroundWakeResult =
  | { status: 'completed'; turn?: RunTurnResult; laneId: string; turnId: number; replayed?: boolean }
  | { status: 'deferred'; reason: BackgroundTurnDeferredReason }
  | { status: 'superseded'; reason: string }
  | { status: 'in_progress'; reason: string }
  | { status: 'failed'; error: string; failureKind?: 'authentication'; retryAfterSeconds?: number }

function wakePrompt(input: BackgroundWakeInput): string {
  const attributes = [
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
    const expectedLane = input.laneId?.trim() || ''
    if (expectedLane && loaded.laneId !== expectedLane) {
      return { status: 'superseded', reason: 'claimed_lane_is_not_active' }
    }
    const blocked = () => {
      const live = peekSession(sessionId)
      return Boolean(hasPending(sessionId) || live?.busy || live?.compacting)
    }
    const wakeId = input.wakeId?.trim() || randomUUID()
    if (input.wakeId) {
      const replay = await getTurnByRequestId(wakeId, { signal: input.signal })
      if (!replay.ok) return { status: 'failed', error: replay.error }
      if (replay.found && replay.turn) {
        if (replay.turn.session_id !== sessionId || replay.turn.turn_kind !== 'agent_wake') {
          return { status: 'superseded', reason: 'wake_id_reused_for_another_turn' }
        }
        return {
          status: 'completed', laneId: expectedLane || loaded.laneId,
          turnId: replay.turn.id, replayed: true,
        }
      }
    }
    const result = await tryRunBackgroundSessionTurn(
      sessionId,
      async (): Promise<BackgroundWakeResult> => {
        // Inputs are loaded once before the non-blocking gate to choose the account-wide
        // subscription lock. Reload after acquiring the session lock so Haven CAS uses
        // the round that is current when this wake actually starts.
        const current = await loadBackgroundTurnInputs(sessionId)
        if (expectedLane && current.laneId !== expectedLane) {
          return { status: 'superseded', reason: 'claimed_lane_is_not_active' } as BackgroundWakeResult
        }
        if (input.leaseOwner) {
          const begin = await beginAgentWakeRun({
            sessionId, laneId: expectedLane || current.laneId, wakeId,
            leaseOwner: input.leaseOwner, scheduleVersion: Number(input.scheduleVersion || 0),
            signal: input.signal,
          })
          if (!begin.ok) return { status: 'failed', error: begin.error } as BackgroundWakeResult
          if (begin.status !== 'started') {
            if (begin.status === 'duplicate') return { status: 'in_progress', reason: 'duplicate_callback' }
            if (begin.status === 'limit_reached') return { status: 'deferred', reason: 'session_blocked' }
            return {
              status: 'superseded',
              reason: begin.status === 'scope_mismatch' ? 'claim_scope_mismatch' : 'schedule_superseded',
            }
          }
        }
        const turnResult = await runTurn({
          sessionId,
          requestId: wakeId,
          expectedLastRoundId: 0,
          personaId: current.persona.id,
          text: wakePrompt(input),
          persona: current.persona,
          config: current.config,
          sessionSnapshot: current.sessionSnapshot,
          resumeHint: current.resumeHint,
          turnKind: 'agent_wake',
          persistTurn: false,
          signal: input.signal || new AbortController().signal,
          send: () => undefined,
          close: () => undefined,
        })
        if (!turnResult.ok) {
          if (turnResult.failureKind === 'authentication') {
            // Background cannot ask the user to log in. Keep this state change inside
            // the same lock as the failed turn so a foreground turn cannot interleave.
            const paused = await patchAgentWakeSchedule({
              sessionId,
              laneId: current.laneId,
              expectedVersion: input.scheduleVersion,
              changes: {
                keepalive_paused_until_user: true,
                next_agent_wake_at: '',
                wake_reason: '',
                conversation_silence_check_at: '',
              },
              signal: input.signal,
            })
            if (!paused.ok) {
              console.error('[cc-agent-wake] failed to pause after authentication failure', {
                sessionId, laneId: current.laneId, error: paused.error,
              })
            }
            return {
              status: 'failed',
              error: turnResult.error || 'Claude 登录态失效',
              failureKind: 'authentication',
              retryAfterSeconds: 60 * 60,
            }
          }
          return { status: 'failed', error: turnResult.error || '后台 wake 失败' }
        }
        const noop = parseAgentWakeNoop(turnResult.assistantText || '')
        const assistantText = noop ? '' : turnResult.assistantText || ''
        const session = current.sessionSnapshot.session
        if (!session) return { status: 'failed', error: 'Haven 返回空窗口' }
        // This persistence must remain inside the session coordinator. Releasing the
        // lock before the CAS lets a foreground message race this wake and disappear.
        const persisted = await recordTurnStrict({
          sessionId,
          requestId: wakeId,
          expectedLastRoundId: Number(session.cc_seen_round_id || 0),
          personaId: current.persona.id,
          userText: '',
          assistantText,
          model: current.config.model,
          client: `ob2-chat/${current.persona.id}`,
          route: '/api/cc-agent-wake',
          source: 'cc',
          turnKind: 'agent_wake',
          laneId: current.laneId,
          raw: {
            version: 1,
            engine: 'cc',
            cred_mode: current.config.cred,
            cc_lane_id: current.laneId,
            cc_turn_uuid: turnResult.nativeTurnUuid || undefined,
            model: current.config.model,
            persona_id: current.persona.id,
            usage: turnResult.usage || undefined,
            cache_diagnostic: turnResult.cacheDiagnostic || undefined,
            thinking: turnResult.thinking || undefined,
            process: turnResult.process?.length ? turnResult.process : undefined,
            display_segments: assistantText
              ? turnResult.displaySegments || buildDisplaySegments(assistantText)
              : buildDisplaySegments(''),
          },
          agentWakeUpdate: {
            model_activity_at: turnResult.modelActivityAt
              ? new Date(turnResult.modelActivityAt).toISOString()
              : input.at,
            cache_refresh_at: turnResult.cacheRefreshAt
              ? new Date(turnResult.cacheRefreshAt).toISOString()
              : '',
            wake_cause: input.cause,
            agent_wake: {
              wake_id: wakeId,
              cause: input.cause,
              at: input.at,
              reason: input.reason || '',
              status: noop?.status || '',
            },
            wake_decision: turnResult.wakeDecision || undefined,
          },
          signal: input.signal,
        })
        if (!persisted.ok || !persisted.stored) {
          return { status: 'failed', error: persisted.error || '后台 wake 未保存到 Haven' }
        }
        return {
          status: 'completed',
          turn: { ...turnResult, assistantText, displaySegments: buildDisplaySegments(assistantText) },
          laneId: current.laneId,
          turnId: persisted.turnId,
        }
      },
      blocked,
      { subscription: loaded.config.cred === 'subscription' },
    )
    if (result.status === 'deferred') return result
    return result.value
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : '后台 wake 失败' }
  }
}
