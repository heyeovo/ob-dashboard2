import { randomUUID } from 'node:crypto'
import { hasPending } from '@/app/lib/ccChannel'
import { peekSession } from '@/app/lib/ccSession'
import { runTurn, type RunTurnResult } from '@/app/lib/cc/runTurn'
import { loadBackgroundTurnInputs } from '@/app/lib/cc/turnInputs'
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
    return result.value.ok
      ? { status: 'completed', turn: result.value, laneId: loaded.laneId }
      : { status: 'failed', error: result.value.error || '后台 wake 失败' }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : '后台 wake 失败' }
  }
}
