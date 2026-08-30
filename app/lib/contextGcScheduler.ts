import { applyContextGc, scanContextGc } from './contextGc'
import { activateContextGcFork, prepareSessionForContextGc } from './ccSession'
import { getConversationSession, listSessions, patchConversationContextGc } from './havenTurns'
import { isAutomationRunnerBusy } from './automationRunnerState'
import { getHavenBaseUrl, getSessionCookie } from './api'

const TIMER_KEY = '__ob2_context_gc_timer__'
const RUN_KEY = '__ob2_context_gc_running__'
const ATTEMPT_KEY = '__ob2_context_gc_attempts__'
type SchedulerGlobal = typeof globalThis & {
  [TIMER_KEY]?: ReturnType<typeof setInterval>
  [RUN_KEY]?: boolean
  [ATTEMPT_KEY]?: Set<string>
}

function hongKongClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { date: `${value.year}-${value.month}-${value.day}`, hour: Number(value.hour), minute: Number(value.minute) }
}

async function preGcAutomationsBusy(): Promise<boolean> {
  if (isAutomationRunnerBusy()) return true
  try {
    const cookie = await getSessionCookie()
    for (const taskType of ['daily_review', 'weekly_journey']) {
      const response = await fetch(
        `${getHavenBaseUrl()}/api/automations/status?task_type=${taskType}`,
        { headers: { Cookie: cookie }, cache: 'no-store' },
      )
      if (!response.ok) return true
      const payload = await response.json() as Record<string, unknown>
      const latestRun = payload.latest_run as Record<string, unknown> | undefined
      const latestExecution = payload.latest_execution as Record<string, unknown> | undefined
      if (latestRun?.status === 'running' || latestExecution?.status === 'running') return true
    }
    return false
  } catch {
    // 无法确认前置自动化已结束时 fail closed，当天不抢跑。
    return true
  }
}

async function runDueContextGc(): Promise<void> {
  const clock = hongKongClock()
  // 05:30 后留半小时重试：日回顾/周轨迹仍在跑、窗口忙碌或工具待批都会等下一分钟。
  if (clock.hour !== 5 || clock.minute < 30) return
  if (await preGcAutomationsBusy()) return
  const state = globalThis as SchedulerGlobal
  if (state[RUN_KEY]) return
  state[RUN_KEY] = true
  const attempts = state[ATTEMPT_KEY] || (state[ATTEMPT_KEY] = new Set())
  try {
    const listed = await listSessions({ limit: 500, source: 'cc' })
    if (!listed.ok) return
    for (const summary of listed.sessions) {
      const loaded = await getConversationSession(summary.session_id)
      if (!loaded.ok || !loaded.session || loaded.session.context_gc?.auto_enabled !== true) continue
      let session = loaded.session
      if (session.context_gc?.last_auto_date === clock.date) continue
      for (const laneId of Object.keys(session.cc_lanes || {})) {
        const attemptKey = `${clock.date}:${summary.session_id}:${laneId}`
        if (attempts.has(attemptKey)) continue
        const lane = session.cc_lanes[laneId]
        const ccSessionId = String(lane?.cc_session_id || '').trim()
        if (!ccSessionId) { attempts.add(attemptKey); continue }
        try {
          const scan = await scanContextGc(ccSessionId, session.context_gc?.protected_keys || [])
          const selectedIds = scan.candidates.filter(item => !item.protected).map(item => item.id)
          if (selectedIds.length === 0) { attempts.add(attemptKey); continue }
          const ready = prepareSessionForContextGc(summary.session_id, laneId)
          if (!ready.ok) continue
          const applied = await applyContextGc(ccSessionId, selectedIds)
          const committed = await patchConversationContextGc({
            sessionId: summary.session_id,
            personaId: session.persona_id,
            expectedStateVersion: session.state_version,
            commit: {
              lane_id: laneId,
              expected_cc_session_id: ccSessionId,
              next_cc_session_id: applied.nextCcSessionId,
              released_tokens: applied.releasedTokens,
              candidate_count: applied.candidateCount,
              counts: applied.counts,
              mode: 'auto',
              local_date: clock.date,
            },
          })
          if (!committed.ok || !committed.session) throw new Error(committed.error || 'Haven commit failed')
          activateContextGcFork(summary.session_id, laneId, applied.nextCcSessionId)
          session = committed.session
          attempts.add(attemptKey)
        } catch (error) {
          console.error('[context-gc] auto run skipped', summary.session_id, laneId, error)
        }
      }
    }
  } finally {
    state[RUN_KEY] = false
  }
}

export function startContextGcScheduler(): void {
  const state = globalThis as SchedulerGlobal
  if (state[TIMER_KEY]) return
  const tick = () => { void runDueContextGc().catch(error => console.error('[context-gc] scheduler failed', error)) }
  state[TIMER_KEY] = setInterval(tick, 60_000)
  if (typeof state[TIMER_KEY] === 'object' && 'unref' in state[TIMER_KEY]!) state[TIMER_KEY]!.unref()
  tick()
}

export const contextGcSchedulerTest = { hongKongClock, preGcAutomationsBusy }
