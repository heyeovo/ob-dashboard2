import { randomUUID } from 'node:crypto'
import { open, readFile, stat, unlink, utimes } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'

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

export type SessionTurnOptions = {
  /** Claude Pro OAuth is account-wide, so subscription model calls must not overlap. */
  subscription?: boolean
  /** Stop waiting for an in-memory/file lock when the browser request is gone. */
  signal?: AbortSignal
}

const COORDINATOR_KEY = '__ob2_cc_turn_coordinator__'
const queues: Map<string, SessionTurnQueue> =
  (globalThis as unknown as Record<string, Map<string, SessionTurnQueue>>)[COORDINATOR_KEY] ||
  ((globalThis as unknown as Record<string, Map<string, SessionTurnQueue>>)[COORDINATOR_KEY] = new Map())

const SUBSCRIPTION_QUEUE_KEY = '__ob2_cc_subscription_turn_coordinator__'
const subscriptionQueue: SessionTurnQueue =
  (globalThis as unknown as Record<string, SessionTurnQueue>)[SUBSCRIPTION_QUEUE_KEY] ||
  ((globalThis as unknown as Record<string, SessionTurnQueue>)[SUBSCRIPTION_QUEUE_KEY] = {
    active: false,
    foregroundWaiting: 0,
    tail: Promise.resolve(),
  })

const SUBSCRIPTION_LOCK_FILE = 'ob2-subscription-turn.lock'
// Heartbeat is every 30s. Four missed heartbeats recover legacy/orphaned locks
// without making a briefly busy event loop look dead.
const SUBSCRIPTION_LOCK_STALE_MS = 2 * 60 * 1000

type SubscriptionLockOwner = {
  token: string
  pid: number
  hostname: string
}

function abortError(): Error {
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function waitForPromise(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

function waitForRetry(signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, 100))
  throwIfAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, 100)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function parseLockOwner(raw: string): SubscriptionLockOwner | null {
  try {
    const value = JSON.parse(raw) as Partial<SubscriptionLockOwner>
    if (
      typeof value.token === 'string'
      && Number.isInteger(value.pid)
      && Number(value.pid) > 0
      && typeof value.hostname === 'string'
    ) {
      return { token: value.token, pid: Number(value.pid), hostname: value.hostname }
    }
  } catch {
    // Older releases wrote "pid:uuid". Keep treating those as lease-only locks.
  }
  return null
}

function ownerProcessIsDead(owner: SubscriptionLockOwner | null): boolean {
  if (!owner || owner.hostname !== hostname()) return false
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

function subscriptionLockPath(): string {
  const testRoot = process.env.OB2_TEST_SUBSCRIPTION_LOCK_DIR?.trim()
  if (testRoot) return path.join(/*turbopackIgnore: true*/ testRoot, SUBSCRIPTION_LOCK_FILE)
  if (process.env.NODE_ENV === 'test') return ''
  const configRoot = process.env.CLAUDE_CONFIG_DIR?.trim()
  return configRoot ? path.join(/*turbopackIgnore: true*/ configRoot, SUBSCRIPTION_LOCK_FILE) : ''
}

async function acquireSubscriptionFileLock(
  wait: boolean,
  signal?: AbortSignal,
): Promise<(() => Promise<void>) | null> {
  const lockPath = subscriptionLockPath()
  if (!lockPath) return async () => undefined
  const token = `${process.pid}:${randomUUID()}`
  const owner: SubscriptionLockOwner = { token, pid: process.pid, hostname: hostname() }

  for (;;) {
    throwIfAborted(signal)
    try {
      const handle = await open(/*turbopackIgnore: true*/ lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(owner), 'utf8')
      } finally {
        await handle.close()
      }
      const heartbeat = setInterval(() => {
        const now = new Date()
        void utimes(/*turbopackIgnore: true*/ lockPath, now, now).catch(() => undefined)
      }, 30_000)
      heartbeat.unref?.()
      return async () => {
        clearInterval(heartbeat)
        try {
          const current = parseLockOwner(await readFile(/*turbopackIgnore: true*/ lockPath, 'utf8'))
          if (current?.token === token) {
            await unlink(/*turbopackIgnore: true*/ lockPath)
          }
        } catch {
          // 容器强制退出或锁已被清理时，无需在收尾再失败。
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      try {
        const [info, rawOwner] = await Promise.all([
          stat(/*turbopackIgnore: true*/ lockPath),
          readFile(/*turbopackIgnore: true*/ lockPath, 'utf8'),
        ])
        if (
          ownerProcessIsDead(parseLockOwner(rawOwner))
          || Date.now() - info.mtimeMs > SUBSCRIPTION_LOCK_STALE_MS
        ) {
          await unlink(/*turbopackIgnore: true*/ lockPath)
          continue
        }
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw staleError
      }
      if (!wait) return null
      await waitForRetry(signal)
    }
  }
}

async function runWithSubscriptionFileLock<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!subscriptionLockPath()) return run()
  const release = await acquireSubscriptionFileLock(true, signal)
  try {
    return await run()
  } finally {
    await release?.()
  }
}

async function runForegroundQueue<T>(
  queue: SessionTurnQueue,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  queue.foregroundWaiting += 1
  const previous = queue.tail
  let release!: () => void
  queue.tail = new Promise<void>(resolve => { release = resolve })
  try {
    await waitForPromise(previous, signal)
  } catch (error) {
    queue.foregroundWaiting -= 1
    void previous.then(release)
    throw error
  }
  queue.foregroundWaiting -= 1
  queue.active = true
  try {
    return await run()
  } finally {
    queue.active = false
    release()
  }
}

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
  options: SessionTurnOptions = {},
): Promise<T> {
  const runForSession = () => {
    const queue = queueFor(sessionId)
    return runForegroundQueue(queue, run, options.signal).finally(() => cleanup(sessionId, queue))
  }
  return options.subscription
    ? runForegroundQueue(
      subscriptionQueue,
      () => runWithSubscriptionFileLock(runForSession, options.signal),
      options.signal,
    )
    : runForSession()
}

/** Serialize a non-chat Claude Pro job with foreground chat turns. */
export function runForegroundSubscriptionTurn<T>(run: () => Promise<T>): Promise<T> {
  return runForegroundQueue(subscriptionQueue, () => runWithSubscriptionFileLock(run))
}

/**
 * Background wake is deliberately non-blocking. A running/queued foreground
 * turn wins before the wake reaches the shared SDK iterator.
 */
export async function tryRunBackgroundSessionTurn<T>(
  sessionId: string,
  run: () => Promise<T>,
  blocked: () => boolean = () => false,
  options: SessionTurnOptions = {},
): Promise<BackgroundTurnResult<T>> {
  let releaseSubscription: () => void = () => {}
  let releaseSubscriptionFile: (() => Promise<void>) | null = null
  if (options.subscription) {
    if (subscriptionQueue.foregroundWaiting > 0) {
      return { status: 'deferred', reason: 'foreground_waiting' }
    }
    if (subscriptionQueue.active) return { status: 'deferred', reason: 'turn_running' }
    if (subscriptionLockPath()) {
      releaseSubscriptionFile = await acquireSubscriptionFileLock(false)
      if (!releaseSubscriptionFile) return { status: 'deferred', reason: 'turn_running' }
    }
    subscriptionQueue.tail = new Promise<void>(resolve => { releaseSubscription = resolve })
    subscriptionQueue.active = true
  }
  const queue = queueFor(sessionId)
  try {
    if (blocked()) return { status: 'deferred', reason: 'session_blocked' }
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
    }
  } finally {
    cleanup(sessionId, queue)
    if (options.subscription) {
      subscriptionQueue.active = false
      releaseSubscription()
      await releaseSubscriptionFile?.()
    }
  }
}

export function resetSessionTurnCoordinatorForTests(): void {
  queues.clear()
  subscriptionQueue.active = false
  subscriptionQueue.foregroundWaiting = 0
  subscriptionQueue.tail = Promise.resolve()
}
