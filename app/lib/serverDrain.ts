import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const DRAIN_MARKER_TTL_MS = 11 * 60_000
export const DRAIN_STOP_GRACE_MS = 20_000
type Work = { sessionId: string; requestId: string; startedAt: number; stop?: () => void | Promise<void> }
type Marker = Work & { drainStartedAt: number; pid: number }
type DrainState = {
  draining: boolean; startedAt: number; works: Set<Work>; markers: Map<string, Marker>
  timer?: ReturnType<typeof setInterval>; idleAt?: number; stoppingAt?: number
  registered?: boolean
}
const root = globalThis as typeof globalThis & { __ob2_server_drain?: DrainState }
const state: DrainState = root.__ob2_server_drain ||= { draining: false, startedAt: 0, works: new Set(), markers: new Map() }

export function isDraining() { return state.draining }

function markerPath(sessionId: string) {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim()
  // Test/local runtimes without a shared Claude volume have no other container.
  return dir ? path.join(/*turbopackIgnore: true*/ dir, 'ob2-drain', `${encodeURIComponent(sessionId)}.json`) : ''
}

export function previousInstanceFinishing(sessionId: string, now = Date.now()): boolean {
  const file = markerPath(sessionId)
  if (!file) return false
  try {
    const marker = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, 'utf8')) as Marker
    if (marker.sessionId !== sessionId || !Number.isFinite(marker.drainStartedAt)) return true
    if (now - marker.drainStartedAt <= DRAIN_MARKER_TTL_MS) return true
    unlinkSync(/*turbopackIgnore: true*/ file)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    // Unreadable/corrupt coordination state must not allow concurrent transcript writes.
    console.error('[server-drain] marker read failed', sessionId, error)
    return true
  }
}

export function drainRejection(sessionId?: string): Response | null {
  const error = isDraining() ? 'server_draining'
    : sessionId && previousInstanceFinishing(sessionId) ? 'previous_instance_finishing' : null
  return error ? Response.json({ ok: false, error, retry_after_ms: error === 'server_draining' ? 3000 : 5000 },
    { status: error === 'server_draining' ? 503 : 409, headers: { 'Retry-After': error === 'server_draining' ? '3' : '5' } }) : null
}

function writeMarker(work: Work) {
  if (!work.sessionId || state.markers.has(work.sessionId)) return
  const file = markerPath(work.sessionId)
  if (!file) return
  const marker: Marker = { sessionId: work.sessionId, requestId: work.requestId,
    startedAt: work.startedAt, drainStartedAt: state.startedAt, pid: process.pid }
  mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(/*turbopackIgnore: true*/ temp, JSON.stringify(marker), { mode: 0o600 })
  renameSync(/*turbopackIgnore: true*/ temp, /*turbopackIgnore: true*/ file)
  state.markers.set(work.sessionId, marker)
}

function removeMarker(sessionId: string) {
  const owned = state.markers.get(sessionId)
  if (!owned) return
  const file = markerPath(sessionId)
  try {
    const current = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, 'utf8')) as Marker
    // Container PIDs can coincide; compare this drain's timestamp as well.
    if (current.pid === owned.pid && current.drainStartedAt === owned.drainStartedAt
      && current.requestId === owned.requestId) unlinkSync(/*turbopackIgnore: true*/ file)
    state.markers.delete(sessionId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') state.markers.delete(sessionId)
    else console.error('[server-drain] marker cleanup failed', sessionId, error)
  }
}

/** Register synchronously after admission, before the first await. Includes preflight,
 * queued work and final Haven writes, not just the period the SDK reports busy. */
export function trackDrainWork(input: Omit<Work, 'startedAt'> & { startedAt?: number }) {
  const work: Work = { ...input, startedAt: input.startedAt ?? Date.now() }
  state.works.add(work)
  if (state.draining) writeMarker(work)
  let finished = false
  return () => {
    if (finished) return
    finished = true
    state.works.delete(work)
    if (![...state.works].some(item => item.sessionId === work.sessionId)) removeMarker(work.sessionId)
  }
}

type DrainDependencies = {
  exit: () => void; busy: () => boolean; stop: () => void | Promise<void>; stopSchedulers: () => void
  activeSessions: () => Work[]
}
let dependencies: DrainDependencies = {
  exit: () => process.exit(0), busy: () => false, stop: () => {}, stopSchedulers: () => {}, activeSessions: () => [],
}
export function configureServerDrain(value: Partial<DrainDependencies>) { dependencies = { ...dependencies, ...value } }

export function startDrain(signal: string) {
  if (state.draining) return
  state.draining = true
  state.startedAt = Date.now()
  console.log('[server-drain] starting', signal)
  dependencies.stopSchedulers()
  // Synchronous publication ensures the new process sees markers before this
  // process yields to its event loop. All existing operations are already tracked.
  for (const work of [...state.works, ...dependencies.activeSessions()]) {
    try { writeMarker(work) } catch (error) { console.error('[server-drain] marker write failed', work.sessionId, error) }
  }
  const configured = Number(process.env.DRAIN_TIMEOUT_MS || 570_000)
  const timeout = Number.isFinite(configured) && configured > 0 ? configured : 570_000
  const exit = () => {
    if (state.timer) clearInterval(state.timer)
    for (const sessionId of state.markers.keys()) removeMarker(sessionId)
    console.log('[server-drain] exiting', { remaining: state.works.size })
    dependencies.exit()
  }
  const tick = () => {
    const now = Date.now()
    const busy = state.works.size > 0 || dependencies.busy()
    // Remove fallback registry markers as soon as their operation has finished.
    const sessions = new Set([...state.works, ...dependencies.activeSessions()].map(work => work.sessionId))
    for (const sessionId of state.markers.keys()) if (!sessions.has(sessionId)) removeMarker(sessionId)
    if (!busy) {
      state.idleAt ??= now
      if (now - state.idleAt >= 2000) { exit(); return }
    } else state.idleAt = undefined
    if (state.stoppingAt !== undefined) {
      if (now - state.stoppingAt >= DRAIN_STOP_GRACE_MS) exit()
    } else if (now - state.startedAt >= timeout && busy) {
      state.stoppingAt = now
      console.log('[server-drain] deadline reached; stopping active turns')
      for (const work of state.works) if (work.stop) void Promise.resolve().then(work.stop).catch(console.error)
      void Promise.resolve().then(dependencies.stop).catch(console.error)
    }
  }
  state.timer = setInterval(tick, 1000)
  tick()
}

export function registerDrainSignals() {
  if (state.registered || process.env.NEXT_MANUAL_SIG_HANDLE !== 'true') return
  state.registered = true
  process.on('SIGTERM', () => startDrain('SIGTERM'))
  process.on('SIGINT', () => startDrain('SIGINT'))
}

export function resetServerDrainForTests() {
  if (state.timer) clearInterval(state.timer)
  for (const sessionId of state.markers.keys()) removeMarker(sessionId)
  state.draining = false; state.startedAt = 0; state.idleAt = undefined; state.stoppingAt = undefined
  state.timer = undefined; state.works.clear()
  dependencies = { exit: () => process.exit(0), busy: () => false, stop: () => {}, stopSchedulers: () => {}, activeSessions: () => [] }
}
