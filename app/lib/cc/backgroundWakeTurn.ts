import { randomUUID } from 'node:crypto'
import { hasPending } from '@/app/lib/ccChannel'
import { peekSession } from '@/app/lib/ccSession'
import { runTurn, type RunTurnResult } from '@/app/lib/cc/runTurn'
import { loadBackgroundTurnInputs } from '@/app/lib/cc/turnInputs'
import { beginAgentWakeRun, getTurnByRequestId, recordTurnStrict } from '@/app/lib/havenTurns'
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
      async () => {
        if (input.leaseOwner) {
          const begin = await beginAgentWakeRun({
            sessionId, laneId: expectedLane || loaded.laneId, wakeId,
            leaseOwner: input.leaseOwner, scheduleVersion: Number(input.scheduleVersion || 0),
            signal: input.signal,
          })
          if (!begin.ok) return { gateStatus: 'failed', gateError: begin.error } as const
          if (begin.status !== 'started') {
            return { gateStatus: begin.status, gateError: '' } as const
          }
        }
        const turn = await runTurn({
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
        })
        return { gateStatus: 'started', gateError: '', turn } as const
      },
      blocked,
    )
    if (result.status === 'deferred') return result
    if (result.value.gateStatus === 'duplicate') return { status: 'in_progress', reason: 'duplicate_callback' }
    if (result.value.gateStatus === 'superseded') return { status: 'superseded', reason: 'schedule_superseded' }
    if (result.value.gateStatus === 'scope_mismatch') return { status: 'superseded', reason: 'claim_scope_mismatch' }
    if (result.value.gateStatus === 'limit_reached') return { status: 'deferred', reason: 'session_blocked' }
    if (result.value.gateStatus !== 'started' || !('turn' in result.value)) {
      return { status: 'failed', error: result.value.gateError || '后台 wake begin 失败' }
    }
    const turnResult = result.value.turn
    if (!turnResult) return { status: 'failed', error: '后台 wake 未返回 turn' }
    if (!turnResult.ok) return { status: 'failed', error: turnResult.error || '后台 wake 失败' }
    const noop = parseAgentWakeNoop(turnResult.assistantText || '')
    const assistantText = noop ? '' : turnResult.assistantText || ''
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
        usage: turnResult.usage || undefined,
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
      laneId: loaded.laneId,
      turnId: persisted.turnId,
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : '后台 wake 失败' }
  }
}
