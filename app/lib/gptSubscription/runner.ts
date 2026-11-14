import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { getPersona } from '../havenPersonas'
import { recallForPrompt } from '../havenRecall'
import { estimateTextTokens, splitRecallModules } from '../recallDisplay'
import { resolveRecallEnabled } from '../recallMode'
import { getConversationSession, getTurnByRequestId, listAllTurns, patchConversationSessionState,
  recordTurnStrict, type HavenTurn, type StrictRecordTurnInput } from '../havenTurns'
import { loadRollingWindowAppend } from '../cc/windowPrompt'
import { createTurnBroadcast, finishTurn, publishTurn, turnStream, type TurnBroadcast } from '../cc/turnBroadcast'
import { drainRejection, trackDrainWork } from '../serverDrain'
import { buildGptContext } from './context'
import { controlGptRequest, GptTransportError, streamGpt } from './transport'
import { GPT_ENGINE, gptError, type GptDone, type GptError, type GptEventMap, type GptRequest } from './contract'

export const GPT_TURN_TIMEOUT_MS = 9 * 60_000
type Job = {
  request: GptRequest; fingerprint: string; turn: TurnBroadcast; owner: string
  abort: AbortController; finishWork: () => void; draft?: StrictRecordTurnInput
  generationError?: GptError; done?: GptDone; admitted: boolean
}
const root = globalThis as typeof globalThis & { __ob2_gpt_jobs?: Map<string, Job> }
const jobs = root.__ob2_gpt_jobs ||= new Map<string, Job>()

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
  return value
}
export function requestFingerprint(request: GptRequest) {
  // Include all behavior-affecting explicit choices; absent choices stay absent on retry.
  return createHash('sha256').update(JSON.stringify(stable({ ...request, mode: 'chat', attachment_ids: undefined }))).digest('hex')
}
function raw(turn: HavenTurn): Record<string, unknown> {
  try { return JSON.parse(turn.raw_json || '{}') } catch { return {} }
}
function send<K extends keyof GptEventMap>(job: Job, event: K, value: GptEventMap[K]) { publishTurn(job.turn, event, value) }
function errorResponse(error: GptError, status = 409) { return Response.json({ ok: false, error }, { status }) }
function matches(turn: HavenTurn, job: Job) {
  return turn.source === GPT_ENGINE && turn.session_id === job.request.session_id
    && turn.persona_id === job.request.persona_id && raw(turn).gpt_request_fingerprint === job.fingerprint
}
function replay(job: Job, turn: HavenTurn) {
  const stored = raw(turn)
  send(job, 'start', { session_id: job.request.session_id, request_id: job.request.request_id, at: job.turn.startedAt, idempotent_replay: true })
  send(job, 'init', { engine: GPT_ENGINE, model: turn.model, session_id: turn.session_id, request_id: job.request.request_id })
  if (stored.recall && typeof stored.recall === 'object') send(job, 'recall', stored.recall as GptEventMap['recall'])
  if (turn.assistant_text) send(job, 'delta', { id: 'text-0', text: turn.assistant_text })
  const outcome = stored.outcome === 'completed' ? 'completed' : stored.outcome === 'cancelled' ? 'cancelled' : 'failed'
  if (stored.generation_error) send(job, 'error', { ...stored.generation_error as GptError, partial_saved: true })
  const done: GptDone = { request_id: job.request.request_id, turn_id: turn.id, round_id: turn.round_id,
    user_message_id: turn.user_message_id || '', assistant_message_id: turn.assistant_message_id || '',
    idempotent_replay: true, engine: GPT_ENGINE, model: turn.model,
    usage: stored.usage as GptDone['usage'] || null, interrupted: outcome !== 'completed', outcome, elapsed_ms: 0 }
  job.done = done; send(job, 'done', done)
}

async function persist(job: Job) {
  const request = job.request
  const result = await recordTurnStrict(job.draft!)
  if (!result.ok || !result.stored) {
    // Never mark generated output as successfully saved on an ambiguous network result.
    const unknown = result.httpStatus == null
    send(job, 'error', { ...gptError(request.request_id, result.code || (unknown ? 'persistence_unknown' : 'persistence_failed'),
      result.error || '回复已生成，但无法确认保存结果，请用同一发送标识重试', 'persistence', true),
    http_status: result.httpStatus, persistence_unknown: unknown, generated_not_saved: !unknown,
    expected_last_round_id: request.expected_last_round_id,
    actual_last_round_id: typeof result.details.actual_last_round_id === 'number' ? result.details.actual_last_round_id : undefined })
    return
  }
  const saved = job.draft!.raw as Record<string, unknown>
  const outcome = saved.outcome as GptDone['outcome']
  if (job.generationError) send(job, 'error', { ...job.generationError, partial_saved: true })
  const done: GptDone = { request_id: request.request_id, turn_id: result.turnId, round_id: result.roundId,
    user_message_id: result.userMessageId, assistant_message_id: result.assistantMessageId,
    idempotent_replay: result.idempotentReplay, engine: GPT_ENGINE, model: job.draft!.model!,
    usage: saved.usage as GptDone['usage'], interrupted: outcome !== 'completed', outcome,
    elapsed_ms: Date.now() - job.turn.startedAt }
  job.done = done; send(job, 'done', done)
}

async function finish(job: Job) {
  if (job.admitted) {
    // Finish failure cannot turn a saved message into a failed message. Receipt remains fail-closed.
    await controlGptRequest({ action: 'finish', request_id: job.request.request_id,
      session_id: job.request.session_id, owner: job.owner }).catch(() => {})
  }
  finishTurn(job.turn); job.finishWork()
  // Keep drafts only as long as the shared event replay buffer (two minutes).
  const timer = setTimeout(() => { if (jobs.get(job.request.session_id) === job) jobs.delete(job.request.session_id) }, 120_000)
  timer.unref?.()
}

function generationFailure(job: Job, error: unknown): GptError {
  if (job.abort.signal.aborted) return gptError(job.request.request_id, 'cancelled', '生成已停止', 'generation')
  if (error instanceof GptTransportError) return { ...gptError(job.request.request_id, error.code,
    error.message, 'generation', error.retryable), action: error.action, http_status: error.status,
    official_request_id: error.officialRequestId }
  return gptError(job.request.request_id, 'gpt_generation_failed', 'GPT 回复中断，已有文字会保留，请重试', 'generation', true)
}

async function generate(job: Job, prepared: {
  session: NonNullable<Awaited<ReturnType<typeof getConversationSession>>['session']>
  persona: NonNullable<Awaited<ReturnType<typeof getPersona>>['persona']>
  history: HavenTurn[]; exclusions: string[]; rollingAppend: string; model: string
}) {
  const request = job.request
  let text = ''
  let usage: GptDone['usage'] = null
  let responseId: string | undefined
  let officialRequestId: string | undefined
  let outcome: GptDone['outcome'] = 'failed'
  let startedModel = false
  let recallData: Record<string, unknown> = {}
  let context: Record<string, unknown> = {}
  try {
    const recall = resolveRecallEnabled(request.recall, prepared.session.recall_mode, 'chat')
      ? await recallForPrompt(request.text, { sessionId: request.session_id, excludeIds: prepared.exclusions,
        maxChars: 80_000, signal: job.abort.signal }) : null
    const recalledText = recall?.ok ? recall.additionalContext : ''
    recallData = {
      ok: recall?.ok ?? true, injected: Boolean(recalledText), card_count: recall?.cardCount || 0,
      chars: recalledText.length, estimated_tokens: estimateTextTokens(recalledText),
      elapsed_ms: recall?.elapsedMs || 0, domains: recall?.domains || [],
      modules: recalledText ? splitRecallModules(recalledText, recall?.cardCount || 0) : [],
      recalled_ids: recall?.ok ? recall.recalledIds : [], excluded_count: prepared.exclusions.length,
      error: recall?.error || undefined,
    }
    send(job, 'recall', recallData as GptEventMap['recall'])
    recallData.additional_context = recalledText
    const assembled = buildGptContext({ ...prepared, recall: recalledText, text: request.text })
    context = assembled.context; send(job, 'context', context)
    job.abort.signal.throwIfAborted()
    startedModel = true
    const result = await streamGpt({ request_id: request.request_id, model: prepared.model,
      instructions: assembled.instructions, input: assembled.input }, job.abort.signal, delta => {
      text += delta; send(job, 'delta', { id: 'text-0', text: delta })
    })
    usage = result.usage; responseId = result.responseId; officialRequestId = result.requestId
    outcome = 'completed'
    send(job, 'usage', { usage })
  } catch (error) {
    job.generationError = generationFailure(job, error)
    outcome = job.abort.signal.aborted ? 'cancelled' : 'failed'
    if (!startedModel) { send(job, 'error', job.generationError); return }
  }
  job.draft = {
    sessionId: request.session_id, requestId: request.request_id, personaId: request.persona_id,
    expectedLastRoundId: request.expected_last_round_id, userText: request.text, assistantText: text,
    model: prepared.model, source: GPT_ENGINE, client: `ob2-gpt/${request.persona_id}`, route: '/api/cc-chat-gpt',
    recalledBucketIds: recallData.recalled_ids as string[] || [], timeoutMs: 30_000,
    raw: { version: 1, engine: GPT_ENGINE, model: prepared.model, request_id: request.request_id,
      gpt_request_fingerprint: job.fingerprint, rolling_context_revision: prepared.session.context_revision,
      outcome, stop_reason: outcome, usage, response_id: responseId, official_request_id: officialRequestId,
      recall: recallData, context, generation_error: job.generationError },
  }
  await persist(job)
}

export async function startGptTurn(request: GptRequest, signal: AbortSignal): Promise<Response> {
  const fingerprint = requestFingerprint(request)
  const previous = jobs.get(request.session_id)
  if (previous && previous.request.request_id === request.request_id) {
    if (previous.fingerprint !== fingerprint) return errorResponse(gptError(request.request_id, 'request_id_reused', '同一发送标识不能用于不同内容'))
    if (!previous.turn.done || previous.done) {
      if (previous.turn.truncated) return errorResponse(gptError(request.request_id, 'stream_buffer_lost', '实时缓冲已超限，请等待保存后重新读取历史'))
      return turnStream(previous.turn, signal)
    }
    // Persistence retry reuses generated text, never the model.
    if (previous.draft) return retryPersistence(previous, signal)
  }
  if (previous && !previous.turn.done) return errorResponse(gptError(request.request_id, 'conversation_busy', '这个窗口正在生成，请接回或停止当前回复'))
  if (previous?.draft && !previous.done) return errorResponse(gptError(request.request_id, 'persistence_pending', '上一条回复尚未确认保存，请先核对或重试保存'))
  const rejected = drainRejection(request.session_id)
  if (rejected) return rejected
  const abort = new AbortController()
  const turn = createTurnBroadcast({ engine: GPT_ENGINE, requestId: request.request_id, sessionId: request.session_id,
    userText: request.text, attachmentIds: [], startedAt: Date.now() }, async () => { abort.abort() })
  if (!turn) return errorResponse(gptError(request.request_id, 'conversation_busy', '这个窗口已有进行中的回复'))
  turn.controller.signal.addEventListener('abort', () => abort.abort(), { once: true })
  const job: Job = { request, fingerprint, turn, owner: randomUUID().replaceAll('-', ''), abort,
    finishWork: trackDrainWork({ sessionId: request.session_id, requestId: request.request_id, stop: () => abort.abort() }), admitted: false }
  jobs.set(request.session_id, job)
  const timer = setTimeout(() => abort.abort(), GPT_TURN_TIMEOUT_MS); timer.unref?.()
  let handedOff = false
  try {
    const saved = await getTurnByRequestId(request.request_id, { signal: abort.signal })
    if (!saved.ok) throw gptError(request.request_id, 'haven_read_failed', '无法核对已保存记录，请稍后重试', 'preflight', true)
    if (saved.found && saved.turn) {
      if (!matches(saved.turn, job)) throw gptError(request.request_id, 'request_id_reused', '同一发送标识已用于其他消息')
      replay(job, saved.turn)
      return turnStream(turn, signal)
    }
    const [sessionResult, history, persona] = await Promise.all([
      getConversationSession(request.session_id, { includeBucketExclusions: true, includeContextDays: true, signal: abort.signal }),
      listAllTurns(request.session_id, { includeRaw: true, signal: abort.signal }),
      getPersona(request.persona_id, { signal: abort.signal }),
    ])
    if (!sessionResult.ok || !history.ok || !persona.ok || !persona.persona) throw gptError(request.request_id, 'haven_context_failed', '读取窗口、人设或历史失败，请稍后重试', 'preflight', true)
    const old = sessionResult.session
    if (old?.persona_id && old.persona_id !== request.persona_id) throw gptError(request.request_id, 'conversation_persona_conflict', '这个窗口属于另一个协作者')
    if (old?.deleted_at) throw gptError(request.request_id, 'conversation_deleted', '这个窗口已删除')
    const actual = history.turns.at(-1)?.round_id || 0
    if (actual !== request.expected_last_round_id) throw { ...gptError(request.request_id, 'conversation_conflict', '另一端产生了新消息，请刷新后重试'),
      expected_last_round_id: request.expected_last_round_id, actual_last_round_id: actual }
    const model = request.model || old?.gpt_subscription_overrides?.model || ''
    if (!model) throw gptError(request.request_id, 'model_not_configured', '请先选择 GPT 模型')
    const claim = await controlGptRequest({ action: 'claim', request_id: request.request_id, session_id: request.session_id,
      fingerprint, owner: job.owner })
    if (!claim.ok) throw gptError(request.request_id, claim.code || 'request_admission_failed',
      claim.code === 'request_already_admitted' ? '该请求已执行或正在另一实例收尾，请读取历史；不要重复发送' : '这个窗口正在处理另一条消息，请稍后重试')
    job.admitted = true
    const initialized = await patchConversationSessionState({ sessionId: request.session_id, personaId: request.persona_id,
      localEnginePreference: GPT_ENGINE, gptSubscriptionOverrides: { model }, mode: 'chat',
      dailyReviewEnabled: request.include_daily_review ?? old?.daily_review_enabled ?? false,
      initializeDailyReviewSnapshot: request.include_daily_review ?? old?.daily_review_enabled ?? false,
      handoffSnapshot: request.handoff_snapshot, expectedStateVersion: old?.state_version ?? 0 })
    if (!initialized.ok || !initialized.session) throw gptError(request.request_id, 'haven_session_failed', '窗口设置已变化或无法保存，请刷新后重试', 'preflight', true)
    const session = initialized.session
    const rolling = session.rolling_context.strategy === 'daily_rolling'
      ? await loadRollingWindowAppend(request.session_id, session, sessionResult.contextDays, { includeRooms: false })
      : { content: '', history: history.turns, pinnedBucketIds: [] }
    send(job, 'start', { session_id: request.session_id, request_id: request.request_id, at: turn.startedAt })
    send(job, 'init', { engine: GPT_ENGINE, model, session_id: request.session_id, request_id: request.request_id })
    handedOff = true
    void generate(job, { session, persona: persona.persona, history: rolling.history, rollingAppend: rolling.content,
      exclusions: [...new Set([...sessionResult.bucketExclusionIds, ...rolling.pinnedBucketIds])], model })
      .catch(() => send(job, 'error', { ...gptError(request.request_id, 'persistence_unknown', '无法确认保存结果，请用同一发送标识核对', 'persistence', true), persistence_unknown: true }))
      .finally(async () => { clearTimeout(timer); await finish(job) })
    return turnStream(turn, signal)
  } catch (error) {
    const value = error as GptError
    const payload = value.stage ? value : gptError(request.request_id, 'gpt_preflight_failed', 'GPT 请求准备失败，请稍后重试', 'preflight', true)
    send(job, 'error', payload)
    return errorResponse(payload, payload.retryable ? 502 : payload.code === 'model_not_configured' ? 400 : 409)
  } finally {
    if (!handedOff) { clearTimeout(timer); await finish(job) }
  }
}

async function retryPersistence(previous: Job, signal: AbortSignal) {
  const rejected = drainRejection(previous.request.session_id)
  if (rejected) return rejected
  const turn = createTurnBroadcast({ ...previous.turn, startedAt: Date.now() }, async () => {})
  if (!turn) return errorResponse(gptError(previous.request.request_id, 'conversation_busy', '窗口正在处理另一条消息'))
  const job: Job = { ...previous, turn, finishWork: trackDrainWork({ sessionId: previous.request.session_id,
    requestId: previous.request.request_id }) }
  jobs.set(job.request.session_id, job)
  send(job, 'start', { session_id: job.request.session_id, request_id: job.request.request_id, at: turn.startedAt })
  try {
    const saved = await getTurnByRequestId(job.request.request_id)
    if (saved.ok && saved.found && saved.turn) {
      if (matches(saved.turn, job)) replay(job, saved.turn)
      else send(job, 'error', gptError(job.request.request_id, 'request_id_reused', '发送标识已用于其他消息'))
    } else if (saved.ok) {
      send(job, 'init', { engine: GPT_ENGINE, model: job.draft!.model!, session_id: job.request.session_id, request_id: job.request.request_id })
      if (job.draft!.assistantText) send(job, 'delta', { id: 'text-0', text: job.draft!.assistantText })
      await persist(job)
    } else send(job, 'error', { ...gptError(job.request.request_id, 'persistence_unknown', '无法核对保存结果，请稍后重试', 'persistence', true), persistence_unknown: true })
  } catch {
    send(job, 'error', { ...gptError(job.request.request_id, 'persistence_unknown', '无法确认保存结果，请稍后重试', 'persistence', true), persistence_unknown: true })
  } finally { await finish(job) }
  return turnStream(turn, signal)
}

export async function getGptTurn(sessionId: string, requestId: string, signal: AbortSignal, afterSeq: number) {
  const job = jobs.get(sessionId)
  if (job?.request.request_id === requestId) {
    if (afterSeq > job.turn.seq) return errorResponse(gptError(requestId, 'stream_cursor_invalid', '事件位置不匹配，请重新核对历史'))
    if (job.turn.truncated) return errorResponse(gptError(requestId, 'stream_buffer_lost', '实时缓冲已超限，请等待保存后重新读取历史'))
    return turnStream(job.turn, signal, afterSeq)
  }
  const saved = await getTurnByRequestId(requestId)
  if (!saved.ok) return errorResponse(gptError(requestId, 'haven_read_failed', '无法读取聊天记录', 'preflight', true), 502)
  if (saved.found && saved.turn?.session_id === sessionId && saved.turn.source === GPT_ENGINE) {
    // Snapshot is canonical Haven text, not replayed deltas with a reset sequence.
    return Response.json({ ok: true, status: 'saved', turn: saved.turn })
  }
  const receipt = await controlGptRequest({ action: 'status', request_id: requestId, session_id: sessionId })
  return Response.json({ ok: receipt.ok, status: receipt.status === 'finished' ? 'finished_without_turn' : receipt.status || 'not_found',
    retry_after_ms: receipt.status === 'running' ? 5000 : null }, { status: receipt.ok ? 200 : 409 })
}

export function stopGptTurn(sessionId: string, requestId: string) {
  const job = jobs.get(sessionId)
  if (!job || job.request.request_id !== requestId) return { ok: false, code: 'active_request_not_found' }
  if (!job.turn.done) job.abort.abort()
  return { ok: true, cancel_requested: !job.turn.done, request_id: requestId }
}

export function gptActiveTurn(sessionId: string) {
  const job = jobs.get(sessionId)
  return job && !job.turn.done ? { request_id: job.request.request_id, user_text: job.request.text,
    engine: GPT_ENGINE, started_at: job.turn.startedAt } : null
}
