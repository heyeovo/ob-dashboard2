import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildGptAudit } from '@/app/lib/gptSubscription/audit'
import { compareGptAudits, type GptAuditData } from '@/app/lib/gptSubscription/auditTypes'
import GptContextAudit from '@/app/workbench/GptContextAudit'
import { buildGptContext } from '@/app/lib/gptSubscription/context'
import type { HavenTurn, HavenConversationSession } from '@/app/lib/havenTurns'
import type { HavenPersona } from '@/app/lib/havenPersonas'

const f = vi.hoisted(() => ({ turns: vi.fn(), gateway: vi.fn() }))
vi.mock('@/app/lib/havenTurns', () => ({ listTurns: f.turns }))
vi.mock('@/app/lib/gptSubscription/transport', async original => ({
  ...await original<typeof import('@/app/lib/gptSubscription/transport')>(), gptGateway: f.gateway,
}))
import { readGptAudit } from '@/app/lib/gptSubscription/auditRead'

function assembled() {
  return { instructions: '背景😀\n', input: [{ role: 'user' as const, content: '你好' }],
    context: { context_revision: 0, input_tokens_estimated: 10, included_history_rounds: 0, omitted_history_rounds: 0 },
    sourceRounds: [null], auditParts: { persona: '人设', window: '背景😀\n', background: '背景', capability: '', recall: '', current_text: '你好', current_time: '现在' } }
}

describe('GPT context evidence', () => {
  it('keeps real assembled prefix evidence after persistence and changing recall/time', () => {
    const persona = { base_prompt: '固定人设', purpose: '', memory_entries: [], prompt_modules: [] } as unknown as HavenPersona
    const session = { session_id: 's', persona_id: 'ombre', prompt_module_overrides: {}, context_revision: 0,
      rolling_context: { strategy: 'fixed_window' }, daily_review_enabled: false, handoff_snapshot: {} } as unknown as HavenConversationSession
    const first = buildGptContext({ persona, session, history: [], rollingAppend: '', recall: '原召回', text: '原问题', now: new Date('2026-11-16T01:00:00Z') })
    const stored = JSON.stringify({ gpt_runtime_context: first.auditParts.current_time, recall: { additional_context: '原召回' } })
    const next = buildGptContext({ persona, session, history: [{ round_id: 1, source: 'gpt_subscription',
      user_text: '原问题', assistant_text: '原回答', raw_json: stored } as HavenTurn], rollingAppend: '', recall: '新召回', text: '新问题', now: new Date('2026-11-17T01:00:00Z') })
    const before = buildGptAudit('test-model', first)
    const after = buildGptAudit('test-model', next)
    expect(after.instructions).toEqual(before.instructions)
    expect(after.parts.recall).not.toEqual(before.parts.recall)
    expect(after.parts.current_time).not.toEqual(before.parts.current_time)
    expect(after.messages.slice(0, before.messages.length).map(message => message.prefix_hash))
      .toEqual(before.messages.map(message => message.prefix_hash))
    expect(after.messages.slice(0, 2).map(message => message.source_round_id)).toEqual([1, 1])
    expect(JSON.stringify(after)).not.toMatch(/原问题|原召回|北京时间/)
  })
  it('is deterministic, body-free and covers role, order, model and final route options', () => {
    const input = assembled()
    const first = buildGptAudit('test-model', input)
    // Shared with the Python request_hash fixture and the final SDK boundary test.
    expect(first.body_hash).toBe('4ce2163a5107216540247e8e6257f2d082ea0dd2f6887ced7ff847d13c7d0cee')
    expect(buildGptAudit('test-model', input)).toEqual(first)
    expect(JSON.stringify(first)).not.toContain('背景')
    expect(first.instructions.bytes).toBe(Buffer.byteLength(input.instructions))
    expect(buildGptAudit('other-model', input).body_hash).not.toBe(first.body_hash)
    const altered = structuredClone(input); altered.input[0].content = '不同'
    expect(buildGptAudit('test-model', altered).messages[0].hash).not.toBe(first.messages[0].hash)
  })
  it('compares the common prefix instead of treating a growing full-body hash as a prefix change', () => {
    const first = buildGptAudit('test-model', assembled())
    const input = assembled(); input.input.push({ role: 'user', content: '下一条' }); input.sourceRounds.push(null)
    const next = buildGptAudit('test-model', input)
    expect(first.body_hash).not.toBe(next.body_hash)
    expect(next.messages[0].prefix_hash).toBe(first.messages[0].prefix_hash)
    expect(compareGptAudits(first, next)).toContain('前 1 条消息一致')
    next.messages[0].hash = 'f'.repeat(64)
    expect(compareGptAudits(first, next)).toContain('第 1 条首次不同')
    expect(compareGptAudits(null, next)).toContain('缺少发送前记录')
  })
  it('identifies changed instructions without confusing revision zero with missing data', () => {
    const first = buildGptAudit('test-model', assembled())
    const input = assembled(); input.instructions += '新背景'; input.auditParts.background = '新背景'
    expect(compareGptAudits(first, buildGptAudit('test-model', input))).toContain('背景')
    expect(first.context.context_revision).toBe(0)
  })
  it('reads actual old usage, joins durable evidence, and never returns private turn bodies', async () => {
    const evidence = { request_id: 'r', session_id: 's', prepared_at: '2026-11-16T00:00:00Z', snapshot: buildGptAudit('test-model', assembled()) }
    f.turns.mockResolvedValue({ ok: true, turns: [{ id: 2, round_id: 1, request_id: 'r', created_at: evidence.prepared_at,
      model: 'test-model', user_text: 'private正文', raw_json: JSON.stringify({ usage: { input_tokens: 100, cached_tokens: 0 }, context: { context_revision: 0 } }) }] })
    f.gateway.mockResolvedValue(Response.json({ ok: true, records: [], matched_records: [evidence], before_cursor: null }))
    const data = await readGptAudit('s', { title: '测试', context_revision: 1 } as never, new URLSearchParams())
    expect(data.turns[0].usage?.cached_tokens).toBe(0)
    expect(data.turns[0].evidence).toEqual(evidence)
    expect(JSON.stringify(data)).not.toContain('private正文')
    expect(f.gateway).toHaveBeenLastCalledWith('chat-requests', expect.objectContaining({ request_ids: ['r'] }))
  })
  it('distinguishes unreadable evidence from genuinely unrecorded old requests', async () => {
    f.turns.mockResolvedValue({ ok: true, turns: [{ id: 1, round_id: 1, request_id: 'r', raw_json: '{}', created_at: '', model: '' }] })
    f.gateway.mockRejectedValue(new Error('secret'))
    const data = await readGptAudit('s', { title: '', context_revision: 0 } as never, new URLSearchParams())
    expect(data.records_error).toContain('读取失败')
    const html = renderToStaticMarkup(createElement(GptContextAudit, { initial: data, onRefresh: () => {} }))
    expect(html).toContain('记录读取失败'); expect(html).not.toContain('secret')
  })
  it('renders zero as real zero and unknown values separately', () => {
    const data: GptAuditData = { ok: true, engine: 'gpt_subscription', session_id: 's', title: '测试', context_revision: 0,
      records_error: null, before_cursor: null, before_turn_id: null, has_more_turns: false,
      turns: [{ request_id: 'old', round_id: 1, created_at: '', model: 'test-model', usage: { input_tokens: 100, cached_tokens: 0 }, context: {}, evidence: null }] }
    const html = renderToStaticMarkup(createElement(GptContextAudit, { initial: data, onRefresh: () => {} }))
    expect(html).toContain('未记录'); expect(html).toContain('未提供'); expect(html).toContain('>0<')
    expect(html).not.toContain('Claude 工具')
  })
})
