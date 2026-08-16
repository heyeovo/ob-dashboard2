import 'server-only'

type ClientState = {
  failures: number
  lastFailureAt: number
  blockedUntil: number
}

type LoginRateLimitState = {
  clients: Map<string, ClientState>
  globalFailures: number[]
}

const CLIENT_RESET_MS = 15 * 60 * 1000
const GLOBAL_WINDOW_MS = 10 * 60 * 1000
const GLOBAL_FAILURE_LIMIT = 20
const GLOBAL_BLOCK_MS = 60 * 1000
const MAX_CLIENT_DELAY_MS = 30 * 1000

const globalStore = globalThis as typeof globalThis & {
  __ob2LoginRateLimit?: LoginRateLimitState
}

function store(): LoginRateLimitState {
  globalStore.__ob2LoginRateLimit ||= { clients: new Map(), globalFailures: [] }
  return globalStore.__ob2LoginRateLimit
}

function prune(now: number) {
  const state = store()
  state.globalFailures = state.globalFailures.filter(at => at > now - GLOBAL_WINDOW_MS)
  for (const [key, entry] of state.clients) {
    if (entry.lastFailureAt <= now - CLIENT_RESET_MS) state.clients.delete(key)
  }
}

export function loginClientKey(headers: Headers): string {
  const forwarded = (headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const candidate = forwarded || (headers.get('x-real-ip') || '').trim() || 'unknown'
  return candidate.slice(0, 128)
}

export function loginRetryAfterSeconds(clientKey: string, now = Date.now()): number {
  prune(now)
  const state = store()
  const clientBlockedUntil = state.clients.get(clientKey)?.blockedUntil || 0
  const globalBlockedUntil = state.globalFailures.length >= GLOBAL_FAILURE_LIMIT
    ? state.globalFailures[state.globalFailures.length - 1] + GLOBAL_BLOCK_MS
    : 0
  const blockedUntil = Math.max(clientBlockedUntil, globalBlockedUntil)
  return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0
}

export function recordLoginFailure(clientKey: string, now = Date.now()): number {
  prune(now)
  const state = store()
  const previous = state.clients.get(clientKey)
  const failures = previous && previous.lastFailureAt > now - CLIENT_RESET_MS
    ? previous.failures + 1
    : 1
  const delayMs = Math.min(MAX_CLIENT_DELAY_MS, 1000 * (2 ** (failures - 1)))
  state.clients.set(clientKey, { failures, lastFailureAt: now, blockedUntil: now + delayMs })
  state.globalFailures.push(now)
  return Math.ceil(delayMs / 1000)
}

export function recordLoginSuccess(clientKey: string) {
  store().clients.delete(clientKey)
}

export function resetLoginRateLimitForTests() {
  globalStore.__ob2LoginRateLimit = { clients: new Map(), globalFailures: [] }
}
