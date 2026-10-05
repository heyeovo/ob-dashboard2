import { isDraining, trackDrainWork } from '../serverDrain'
import { trpgServerRequest, type TrpgSettings, type YanzhiRuntime, type YanzhiView } from './server'
import { runYanzhiTurn, trpgPublicError, type TrpgTurnKind } from './yanzhiTurn'
import { runDmTurn } from './dmTurn'

export type TrpgTrigger = 'action' | 'table-talk' | 'settle' | 'roll'
type Job = { promise?: Promise<void>; again: boolean; actionKey?: string; checksKey?: string; calledChecks?: Set<string> }
const root = globalThis as typeof globalThis & { __trpgJobs?: Map<string, Job> }
const jobs = root.__trpgJobs ||= new Map<string, Job>()

export function chooseTrpgTurn(view: YanzhiView, runtime: YanzhiRuntime, job: Pick<Job, 'actionKey' | 'checksKey' | 'calledChecks'>): TrpgTurnKind | 'dm' | null {
  if (view.log.some(log => log.author === 'xiaoyang' && log.kind === 'table_talk' && log.seq > runtime.last_seen_seq)) return 'table_talk'
  const actionKey = String(view.log.filter(log => log.author === 'xiaoyang' && log.kind === 'action').at(-1)?.seq || 0)
  if (view.phase === 'yanzhi' && job.actionKey !== actionKey) return 'action'
  const checksKey = view.checks.filter(check => check.owner === 'yanzhi' && check.status === 'pending').map(check => check.id).sort().join(',')
  if (view.phase === 'checks' && checksKey && job.checksKey !== checksKey && checksKey.split(',').some(id => !job.calledChecks?.has(id))) return 'roll'
  if (view.phase === 'dm') return 'dm'
  return null
}

/** Register before the first await; coalesce triggers without tying a turn to browser lifetime. */
export function kickTrpgTurn(gameId: string, trigger: TrpgTrigger): Promise<void> {
  void trigger
  if (isDraining()) return Promise.resolve()
  let job = jobs.get(gameId)
  if (!job) { job = { again: false }; jobs.set(gameId, job) }
  if (job.promise) { job.again = true; return job.promise }
  const current = job
  const finish = trackDrainWork({ sessionId: `trpg:${gameId}`, requestId: 'trpg' })
  current.promise = (async () => {
    try {
      do {
        current.again = false
        let runtime = await trpgServerRequest<YanzhiRuntime>(gameId, 'yanzhi-runtime')
        for (;;) {
          const view = await trpgServerRequest<YanzhiView>(gameId, 'yanzhi-view')
          const kind = chooseTrpgTurn(view, runtime, current)
          if (!kind) break
          if (kind === 'dm') { await runDmTurn(gameId); break }
          if (kind === 'action') current.actionKey = String(view.log.filter(log => log.author === 'xiaoyang' && log.kind === 'action').at(-1)?.seq || 0)
          if (kind === 'roll') {
            const ids = view.checks.filter(check => check.owner === 'yanzhi' && check.status === 'pending').map(check => check.id)
            current.checksKey = ids.sort().join(',')
            current.calledChecks ||= new Set()
            ids.forEach(id => current.calledChecks!.add(id))
          }
          const consumedSeq = view.log.at(-1)?.seq || runtime.last_seen_seq
          try {
            await trpgServerRequest(gameId, 'yanzhi-runtime', 'PUT', { running_since: new Date().toISOString(), last_error: null })
            const settings = await trpgServerRequest<TrpgSettings>(gameId, 'settings')
            const result = await runYanzhiTurn(kind, view, runtime, settings)
            if (result.text) await trpgServerRequest(gameId, 'yanzhi-table-talk', 'POST', { text: result.text })
            const after = await trpgServerRequest<YanzhiView>(gameId, 'yanzhi-view')
            // Do not acknowledge Xiaoyang's messages arriving while the model was working.
            const waiting = after.log.find(log => log.seq > consumedSeq && log.author === 'xiaoyang' && log.kind === 'table_talk')
            const lastSeen = waiting ? waiting.seq - 1 : after.log.at(-1)?.seq || consumedSeq
            runtime = await trpgServerRequest<YanzhiRuntime>(gameId, 'yanzhi-runtime', 'PUT', { session_id: result.session_id, session_tokens: result.session_tokens, last_seen_seq: lastSeen, running_since: null, last_error: null })
          } catch (error) {
            await trpgServerRequest(gameId, 'yanzhi-runtime', 'PUT', { running_since: null, last_error: trpgPublicError(error) })
            return
          }
        }
      } while (current.again)
    } catch (error) {
      // Fire-and-forget callers never receive unhandled rejections or secret-bearing errors.
      await trpgServerRequest(gameId, 'yanzhi-runtime', 'PUT', { running_since: null, last_error: trpgPublicError(error) }).catch(() => undefined)
    } finally { finish(); current.promise = undefined }
  })()
  return current.promise
}
