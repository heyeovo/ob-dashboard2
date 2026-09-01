import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdk.query }))
vi.mock('@/app/lib/ccEnv', () => ({ buildCcEnv: () => ({ HOME: '/home/cc' }) }))

import { POST } from '@/app/api/automation-pro-runner/route'

function request(body: Record<string, unknown>, token = 'runner-secret') {
  return new Request('http://localhost/api/automation-pro-runner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OMBRE_AUTOMATION_PRO_RUNNER_TOKEN = 'runner-secret'
})

describe('/api/automation-pro-runner', () => {
  it('rejects unauthorized calls before starting Agent SDK', async () => {
    const response = await POST(request({ task_type: 'daily_review' }, 'wrong'))
    expect(response.status).toBe(401)
    expect(sdk.query).not.toHaveBeenCalled()
  })

  it('runs a whitelisted task with no tools and subscription credentials', async () => {
    sdk.query.mockReturnValue((async function* () {
      yield { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' }
      yield { type: 'assistant', message: { content: [{ type: 'text', text: '日回顾正文' }] } }
      yield { type: 'result', subtype: 'success', is_error: false, result: '日回顾正文', usage: {} }
    })())
    const response = await POST(request({
      task_type: 'daily_review', system: 'system', user: 'material',
      model: 'claude-sonnet-4-6', max_tokens: 900,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, text: '日回顾正文' })
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ tools: [], allowedTools: [], permissionMode: 'dontAsk' }),
    }))
    expect(sdk.query.mock.calls[0][0].options).not.toHaveProperty('outputFormat')
  })

  it('uses Agent SDK structured output for weekly journey candidates', async () => {
    const flatCandidate = {
      candidate_type: 'no_change',
      rationale_text: '没有实质变化',
      evidence_bucket_ids_text: '',
      revised_content: '',
      summary: '',
      close_stage_end: '',
      close_summary: '',
      create_name: '',
      create_stage_start: '',
      create_summary: '',
      create_content: '',
    }
    sdk.query.mockReturnValue((async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: '{broken json' }] } }
      yield {
        type: 'result', subtype: 'success', is_error: false, result: '{broken json',
        structured_output: flatCandidate, usage: {},
      }
    })())
    const response = await POST(request({
      task_type: 'weekly_journey', system: 'system', user: 'material',
      model: 'claude-sonnet-4-6', max_tokens: 2400,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      text: JSON.stringify({
        candidate_type: 'no_change', rationale: ['没有实质变化'],
        evidence_bucket_ids: [], proposal: {},
      }),
    })
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        systemPrompt: expect.stringContaining('最终传输格式是扁平对象'),
        outputFormat: expect.objectContaining({
          type: 'json_schema',
          schema: expect.objectContaining({
            required: expect.arrayContaining(['candidate_type', 'rationale_text', 'create_content']),
            properties: expect.not.objectContaining({ proposal: expect.anything() }),
          }),
        }),
      }),
    }))
  })

  it.each([
    {
      candidate_type: 'append_current',
      flat: {
        rationale_text: '相处方式有连续变化', evidence_bucket_ids_text: 'bucket-a\nbucket-b',
        revised_content: '新增轨迹正文', summary: '更新后的摘要', close_stage_end: '', close_summary: '',
        create_name: '', create_stage_start: '', create_summary: '', create_content: '',
      },
      proposal: {
        revised_content: '新增轨迹正文', summary: '更新后的摘要',
        evidence_bucket_ids: ['bucket-a', 'bucket-b'],
      },
    },
    {
      candidate_type: 'transition',
      flat: {
        rationale_text: '关系阶段发生变化', evidence_bucket_ids_text: 'bucket-c',
        revised_content: '', summary: '', close_stage_end: '2026-08-18', close_summary: '旧阶段总结',
        create_name: '新的阶段', create_stage_start: '2026-08-18',
        create_summary: '新阶段摘要', create_content: '新阶段正文',
      },
      proposal: {
        close: { stage_end: '2026-08-18', summary: '旧阶段总结' },
        create: {
          name: '新的阶段', stage_start: '2026-08-18', summary: '新阶段摘要',
          content: '新阶段正文', evidence_bucket_ids: ['bucket-c'],
        },
      },
    },
  ])('restores $candidate_type from the flat transport schema', async ({ candidate_type, flat, proposal }) => {
    sdk.query.mockReturnValue((async function* () {
      yield {
        type: 'result', subtype: 'success', is_error: false, result: '', usage: {},
        structured_output: { candidate_type, ...flat },
      }
    })())
    const response = await POST(request({
      task_type: 'weekly_journey', system: 'system', user: 'material', model: 'claude-sonnet-4-6',
    }))
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(JSON.parse(payload.text)).toEqual({
      candidate_type,
      rationale: [flat.rationale_text],
      evidence_bucket_ids: flat.evidence_bucket_ids_text.split('\n'),
      proposal,
    })
  })

  it('fails clearly when weekly journey structured output is missing', async () => {
    sdk.query.mockReturnValue((async function* () {
      yield {
        type: 'result', subtype: 'success', is_error: false,
        result: '{"candidate_type":"no_change"}', usage: {},
      }
    })())
    const response = await POST(request({
      task_type: 'weekly_journey', system: 'system', user: 'material', model: 'claude-sonnet-4-6',
    }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      ok: false,
      error_code: 'pro_structured_output',
      error: 'Claude Pro 未能生成有效的结构化轨迹候选',
    })
  })

  it('preserves structured output retry exhaustion as a safe error category', async () => {
    sdk.query.mockReturnValue((async function* () {
      yield {
        type: 'result', subtype: 'error_max_structured_output_retries', is_error: true,
        errors: ['schema validation failed'], usage: {},
      }
    })())
    const response = await POST(request({
      task_type: 'weekly_journey', system: 'system', user: 'material', model: 'claude-sonnet-4-6',
    }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      ok: false,
      error_code: 'pro_structured_output',
      error: 'Claude Pro 未能生成有效的结构化轨迹候选',
    })
  })

  it('rejects task types outside the two automation allowlist', async () => {
    const response = await POST(request({
      task_type: 'dream', system: 'system', user: 'material', model: 'claude-sonnet-4-6',
    }))
    expect(response.status).toBe(400)
    expect(sdk.query).not.toHaveBeenCalled()
  })
})
