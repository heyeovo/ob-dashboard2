export type SessionTurnPriority = 'foreground' | 'background'

export type BackgroundTurnDeferredReason =
  | 'turn_running'
  | 'foreground_waiting'
  | 'session_blocked'

export type BackgroundTurnResult<T> =
  | { status: 'started'; value: T }
  | { status: 'deferred'; reason: BackgroundTurnDeferredReason }

type SessionTurnQueue = {
  active: boolean
  foregroundWaiting: number
  tail: Promise<void>
}

const COORDINATOR_KEY = '__ob2_cc_turn_coordinator__'
const queues: Map<string, SessionTurnQueue> =
  (globalThis as unknown as Record<string, Map<string, SessionTurnQueue>>)[COORDINATOR_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, SessionTurnQueue>>)[COORDINATOR_KEY] = new Map())

function queueFor(sessionId: string): SessionTurnQueue {
  let queue = queues.get(sessionId)
  if (!queue) {
    queue = { active: false, foregroundWaiting: 0, tail: Promise.resolve() }
    queues.set(sessionId, queue)
  }
  return queue
}

function cleanup(sessionId: string, queue: SessionTurnQueue): void {
  if (!queue.active && queue.foregroundWaiting === 0) queues.delete(sessionId)
}

/**
 * Every foreground CC turn enters through this gate. If a background turn has
 * already started it is allowed to finish; the user turn is first in line next.
 */
export async function runForegroundSessionTurn<T>(
  sessionId: string,
  run: () => Promise<T>,
): Promise<T> {
  const queue = queueFor(sessionId)
  queue.foregroundWaiting += 1
  const previous = queue.tail
  let release!: () => void
  queue.tail = new Promise<void>(resolve => { release = resolve })
  await previous
  queue.foregroundWaiting -= 1
  queue.active = true
  try {
    return await run()
  } finally {
    queue.active = false
    release()
    cleanup(sessionId, queue)
  }
}

/**
 * Background wake is deliberately non-blocking. A running/queued foreground
 * turn wins before the wake reaches the shared SDK iterator.
 */
export async function tryRunBackgroundSessionTurn<T>(
  sessionId: string,
  run: () => Promise<T>,
  blocked: () => boolean = () => false,
): Promise<BackgroundTurnResult<T>> {
  const queue = queueFor(sessionId)
  if (blocked()) {
    cleanup(sessionId, queue)
    return { status: 'deferred', reason: 'session_blocked' }
  }
  if (queue.foregroundWaiting > 0) return { status: 'deferred', reason: 'foreground_waiting' }
  if (queue.active) return { status: 'deferred', reason: 'turn_running' }

  let release!: () => void
  queue.tail = new Promise<void>(resolve => { release = resolve })
  queue.active = true
  try {
    return { status: 'started', value: await run() }
  } finally {
    queue.active = false
    release()
    cleanup(sessionId, queue)
  }
}

export function resetSessionTurnCoordinatorForTests(): void {
  queues.clear()
}
