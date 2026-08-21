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
    const candidate = {
      candidate_type: 'no_change',
      rationale: ['没有实质变化'],
      evidence_bucket_ids: [],
      proposal: {},
    }
    sdk.query.mockReturnValue((async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: '{broken json' }] } }
      yield {
        type: 'result', subtype: 'success', is_error: false, result: '{broken json',
        structured_output: candidate, usage: {},
      }
    })())
    const response = await POST(request({
      task_type: 'weekly_journey', system: 'system', user: 'material',
      model: 'claude-sonnet-4-6', max_tokens: 2400,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, text: JSON.stringify(candidate) })
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        outputFormat: expect.objectContaining({
          type: 'json_schema',
          schema: expect.objectContaining({ required: expect.arrayContaining(['candidate_type', 'proposal']) }),
        }),
      }),
    }))
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

  it('rejects task types outside the two automation allowlist', async () => {
    const response = await POST(request({
      task_type: 'dream', system: 'system', user: 'material', model: 'claude-sonnet-4-6',
    }))
    expect(response.status).toBe(400)
    expect(sdk.query).not.toHaveBeenCalled()
  })
})
