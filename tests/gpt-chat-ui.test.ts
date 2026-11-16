import { describe, expect, it } from 'vitest'
import { consumeGptResponse, ensureGptMessages } from '@/app/cc/gptChatUi'
import { normalizeGptUsage } from '@/app/cc/gptPresentation'
import { effectiveEngine } from '@/app/cc/engineRouting'
import { turnsToMessages, modeOfTurns, metaOfTurns, type HavenTurnRow } from '@/app/cc/ccHistory'
import type { CcMessage, GptDone, GptRequest } from '@/app/cc/types'

const request: GptRequest = { session_id: 's', request_id: 'r', persona_id: 'p', text: 'hello',
  expected_last_round_id: 0, model: 'account-model', mode: 'chat', include_daily_review: true }
const done: GptDone = { request_id: 'r', turn_id: 1, round_id: 1, user_message_id: 'hu', assistant_message_id: 'ha',
  engine: 'gpt_subscription', model: 'account-model', usage: null, interrupted: false,
  outcome: 'completed', idempotent_replay: false, elapsed_ms: 12 }
const turn = (outcome: string = 'completed', text = 'canonical'): HavenTurnRow => ({ id: 1, request_id: 'r', round_id: 1,
  user_message_id: 'hu', assistant_message_id: 'ha', user_text: 'hello', assistant_text: text,
  created_at: '2026-11-15T04:00:00Z', source: 'gpt_subscription', client: 'ob2-gpt/p',
  raw_json: JSON.stringify({ engine: 'gpt_subscription', model: 'account-model', outcome,
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5, cached_tokens: null, reasoning_tokens: null } }) })
function stream(events: Array<[string, unknown]>) {
  return new Response(events.map(([event, data], index) => `id: ${index + 1}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } })
}
function harness(initial?: CcMessage[]) {
  let messages = initial || ensureGptMessages([], request, 1, request)
  const saved: number[] = []; let seq = 0
  return {
    get messages() { return messages }, get seq() { return seq }, saved,
    consume: (response: Response, after = 0) => consumeGptResponse(response, { requestId: 'r', after,
      update: apply => { messages = apply(messages) }, received: value => { seq = value }, saved: round => saved.push(round) }),
  }
}
describe('GPT UI request and recovery contract', () => {
  it('allows GPT remotely without changing remote CC/selfhost routing', () => {
    expect(effectiveEngine(true, 'gpt_subscription')).toBe('gpt_subscription')
    expect(effectiveEngine(true, 'cc')).toBe('selfhost')
    expect(effectiveEngine(false, 'cc')).toBe('cc')
  })
  it('keeps exact retry body and prevents duplicate placeholders', () => {
    const first = ensureGptMessages([], request, 1, request)
    expect(first[1].gptRetryRequest).toEqual(request)
    expect(ensureGptMessages(first, request, 2, request)).toEqual(first)
  })
  it('completes with canonical IDs and native nullable usage', async () => {
    const h = harness(); const key = h.messages[1].id
    await h.consume(stream([['init', { model: 'account-model' }], ['delta', { text: 'hello\n' }], ['done', done]]))
    expect(h.messages[1]).toMatchObject({ id: 'ha', renderKey: key, text: 'hello\n', gptOutcome: 'completed',
      gptUsage: null, interrupted: false, deliveryState: 'saved' })
    expect(h.messages[1].gptRetryRequest).toBeUndefined()
    expect(h.saved).toEqual([1])
  })
  it.each(['cancelled', 'failed'] as const)('saved %s remains interrupted', async outcome => {
    const h = harness()
    await h.consume(stream([['delta', { text: 'partial' }], ['done', { ...done, outcome, interrupted: true }]]))
    expect(h.messages[1]).toMatchObject({ text: 'partial', interrupted: true, deliveryState: 'saved', gptOutcome: outcome })
    expect(h.messages[1].deliveryNote).not.toBe('已保存到 Haven')
  })
  it('replaces a full replay in place instead of appending text or messages', async () => {
    const h = harness()
    await h.consume(stream([['delta', { text: 'original' }], ['done', done]]))
    await h.consume(stream([['delta', { text: 'canonical' }], ['done', { ...done, idempotent_replay: true }]]))
    expect(h.messages).toHaveLength(2)
    expect(h.messages[1].text).toBe('canonical')
  })
  it('deduplicates event sequence on attach', async () => {
    const h = harness(ensureGptMessages([], request, 1, request).map(message => message.role === 'assistant'
      ? { ...message, text: 'first' } : message))
    await h.consume(stream([['delta', { text: 'duplicate' }], ['delta', { text: 'second' }], ['done', done]]), 1)
    expect(h.messages[1].text).toBe('firstsecond')
  })
  it('accepts JSON snapshots and keeps render keys', async () => {
    const h = harness(); const key = h.messages[1].id
    await h.consume(Response.json({ ok: true, status: 'saved', turn: turn('failed', 'saved partial') }))
    expect(h.messages).toHaveLength(2)
    expect(h.messages[1]).toMatchObject({ id: 'ha', renderKey: key, text: 'saved partial', gptOutcome: 'failed', interrupted: true })
  })
  it('does not turn a running receipt or missing turn into a success', async () => {
    const h = harness()
    expect(await h.consume(Response.json({ ok: true, status: 'running' }))).toBe('pending')
    expect(h.messages[1].deliveryState).toBe('detached')
    await h.consume(Response.json({ ok: true, status: 'finished_without_turn' }))
    expect(h.messages[1].deliveryState).toBe('persistence_unknown')
    expect(h.messages[1].gptRetryRequest).toEqual(request)
    expect(h.saved).toEqual([])
  })
  it('retains full request and partial text when saving is unknown', async () => {
    const h = harness()
    await h.consume(stream([['delta', { text: 'unsaved' }], ['error', { request_id: 'r', message: 'save unknown',
      code: 'persistence_unknown', persistence_unknown: true, stage: 'persistence' }]]))
    expect(h.messages[1]).toMatchObject({ text: 'unsaved', deliveryState: 'persistence_unknown', gptRetryRequest: request })
    expect(h.saved).toEqual([])
  })
  it('keeps quota failures actionable without inventing quota or reset', async () => {
    const h = harness()
    await h.consume(stream([['error', { code: 'quota', message: 'quota exceeded', action: 'usage_settings' }]]))
    expect(h.messages[1].deliveryNote).toContain('ChatGPT 设置')
    expect(h.messages[1].deliveryNote).toContain('重置时间未知')
  })
  it('preserves an actionable failure after the partial reply is saved and reloaded', async () => {
    const h = harness()
    const error = { code: 'quota', message: 'quota exceeded', action: 'usage_settings' }
    await h.consume(stream([['delta', { text: 'partial' }], ['error', error], ['done', { ...done, outcome: 'failed', interrupted: true }]]))
    expect(h.messages[1].deliveryNote).toContain('ChatGPT 设置')
    expect(h.messages[1].deliveryNote).toContain('已保存到 Haven')
    const row = turn('failed', 'partial')
    row.raw_json = JSON.stringify({ ...JSON.parse(row.raw_json!), generation_error: error })
    expect(turnsToMessages([row])[1].deliveryNote).toContain('ChatGPT 设置')
  })
  it('requires a terminal event and rejects snapshots of another request', async () => {
    const h = harness()
    await expect(h.consume(stream([['delta', { text: 'partial' }]]))).rejects.toThrow('连接提前结束')
    await expect(h.consume(Response.json({ status: 'saved', turn: { ...turn(), request_id: 'other' } }))).rejects.toThrow('不匹配')
  })
  it('history does not borrow Claude stats, mode or session identity', () => {
    const messages = turnsToMessages([turn('cancelled', '')])
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ engine: 'gpt_subscription', personaId: 'p', gptOutcome: 'cancelled', interrupted: true,
      usage: null, context: null, cacheSnapshot: null, gptUsage: { total_tokens: 5, cached_tokens: null } })
    expect(modeOfTurns([turn()])).toBe('chat')
    expect(metaOfTurns([turn()])).toEqual({ settings: null, ccSessionId: '' })
    expect(normalizeGptUsage({ total_tokens: null, input_tokens: -1 })).toEqual({ input_tokens: null,
      output_tokens: null, total_tokens: null, cached_tokens: null, reasoning_tokens: null })
  })
  it('receives application estimates and elapsed time without inventing model limits', async () => {
    const h = harness()
    await h.consume(stream([['context', { input_tokens_estimated: 1234, application_input_budget: 120000,
      model_context_limit: null, included_history_rounds: 2, omitted_history_rounds: 0 }], ['done', done]]))
    expect(h.messages[1]).toMatchObject({ gptContext: { inputTokensEstimated: 1234,
      applicationInputBudget: 120000, modelContextLimit: null, includedHistoryRounds: 2, omittedHistoryRounds: 0 },
      gptElapsedMs: 12 })
    expect(h.messages[1].context).toBeUndefined()
  })
  it('restores saved estimates, leaving absent duration and model maximum unavailable', () => {
    const row = turn()
    row.raw_json = JSON.stringify({ ...JSON.parse(row.raw_json!), context: {
      input_tokens_estimated: 0, application_input_budget: 120000,
      model_context_limit: null, included_history_rounds: 0, omitted_history_rounds: 0 } })
    expect(turnsToMessages([row])[1]).toMatchObject({ gptContext: { inputTokensEstimated: 0,
      modelContextLimit: null, includedHistoryRounds: 0 }, gptElapsedMs: null })
  })
  it('does not turn a replay placeholder duration into a measured zero', async () => {
    const h = harness()
    await h.consume(stream([['done', { ...done, elapsed_ms: 0, idempotent_replay: true }]]))
    expect(h.messages[1].gptElapsedMs).toBeNull()
  })
})
