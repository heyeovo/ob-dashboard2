import { timingSafeEqual } from 'node:crypto'
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { buildCcEnv } from '@/app/lib/ccEnv'
import { isAutomationRunnerBusy, setAutomationRunnerBusy } from '@/app/lib/automationRunnerState'

export const runtime = 'nodejs'
export const maxDuration = 360

const TASKS = new Set(['daily_review', 'weekly_journey'])
const MODEL_PATTERN = /^claude-(?:sonnet|opus)-[a-z0-9-]+$/i
const WEEKLY_JOURNEY_FLAT_FIELDS = [
  'candidate_type',
  'rationale_text',
  'evidence_bucket_ids_text',
  'revised_content',
  'summary',
  'close_stage_end',
  'close_summary',
  'create_name',
  'create_stage_start',
  'create_summary',
  'create_content',
] as const
const WEEKLY_JOURNEY_OUTPUT_FORMAT: NonNullable<Options['outputFormat']> = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: WEEKLY_JOURNEY_FLAT_FIELDS,
    properties: {
      candidate_type: { type: 'string', enum: ['no_change', 'append_current', 'transition'] },
      rationale_text: { type: 'string' },
      evidence_bucket_ids_text: { type: 'string' },
      revised_content: { type: 'string' },
      summary: { type: 'string' },
      close_stage_end: { type: 'string' },
      close_summary: { type: 'string' },
      create_name: { type: 'string' },
      create_stage_start: { type: 'string' },
      create_summary: { type: 'string' },
      create_content: { type: 'string' },
    },
  },
}
const WEEKLY_JOURNEY_TRANSPORT_INSTRUCTION = `
为绕开当前 Agent SDK 对嵌套 structured output 的已知限制，最终传输格式是扁平对象。
rationale_text 每条理由单独一行；evidence_bucket_ids_text 每个 materials 证据 ID 单独一行。
append_current 使用 revised_content、summary；revised_content 必须是整合、去重后的完整阶段正文，不是追加片段。transition 使用 close_stage_end、close_summary、create_name、create_stage_start、create_summary、create_content。
当前 candidate_type 不使用的字符串字段必须输出空字符串。runner 会确定性还原为产品要求的 proposal 对象，再由 Haven 做最终严格校验。`.trim()

function splitFlatList(value: unknown) {
  return Array.from(new Set(
    String(value || '').split(/[\r\n,，]+/).map(item => item.trim()).filter(Boolean),
  ))
}

function restoreWeeklyJourneyCandidate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Claude Pro structured output missing')
  }
  const flat = value as Record<string, unknown>
  const candidateType = String(flat.candidate_type || '').trim()
  const evidenceIds = splitFlatList(flat.evidence_bucket_ids_text)
  let proposal: Record<string, unknown> = {}
  if (candidateType === 'append_current') {
    proposal = {
      revised_content: String(flat.revised_content || '').trim(),
      summary: String(flat.summary || '').trim(),
      evidence_bucket_ids: evidenceIds,
    }
  } else if (candidateType === 'transition') {
    proposal = {
      close: {
        stage_end: String(flat.close_stage_end || '').trim(),
        summary: String(flat.close_summary || '').trim(),
      },
      create: {
        name: String(flat.create_name || '').trim(),
        stage_start: String(flat.create_stage_start || '').trim(),
        summary: String(flat.create_summary || '').trim(),
        content: String(flat.create_content || '').trim(),
        evidence_bucket_ids: evidenceIds,
      },
    }
  }
  return {
    candidate_type: candidateType,
    rationale: splitFlatList(flat.rationale_text),
    evidence_bucket_ids: evidenceIds,
    proposal,
  }
}

function secureMatch(actual: string, expected: string) {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearer(request: Request) {
  const value = request.headers.get('authorization') || ''
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : ''
}

function errorCode(message: string) {
  const value = message.toLowerCase()
  if (value.includes('usage limit') || value.includes('rate limit') || value.includes('resets')) return 'pro_limit'
  if (value.includes('login') || value.includes('oauth') || value.includes('authentication')) return 'pro_auth'
  if (value.includes('abort') || value.includes('timeout')) return 'pro_timeout'
  if (value.includes('structured output')) return 'pro_structured_output'
  return 'pro_runner_failed'
}

function publicError(code: string) {
  if (code === 'pro_limit') return 'Claude Pro 额度不足或正在限流'
  if (code === 'pro_auth') return 'Claude Pro 登录已失效，需要人工重新登录'
  if (code === 'pro_timeout') return 'Claude Pro 自动化执行超时'
  if (code === 'pro_structured_output') return 'Claude Pro 未能生成有效的结构化轨迹候选'
  return 'Claude Pro 自动化执行失败'
}

export async function POST(request: Request) {
  const expected = process.env.OMBRE_AUTOMATION_PRO_RUNNER_TOKEN?.trim() || ''
  if (!expected) {
    return Response.json({ ok: false, error_code: 'runner_not_configured', error: 'Pro runner 未配置' }, { status: 503 })
  }
  if (!secureMatch(bearer(request), expected)) {
    return Response.json({ ok: false, error_code: 'unauthorized', error: '未授权' }, { status: 401 })
  }

  if (isAutomationRunnerBusy()) {
    return Response.json({ ok: false, error_code: 'pro_busy', error: '另一项 Pro 自动化正在运行' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error_code: 'invalid_input', error: '请求正文不是 JSON' }, { status: 400 })
  }
  const taskType = String(body.task_type || '')
  const system = String(body.system || '')
  const user = String(body.user || '')
  const model = String(body.model || 'claude-sonnet-4-6')
  if (!TASKS.has(taskType) || !system || !user || system.length > 80_000 || user.length > 500_000) {
    return Response.json({ ok: false, error_code: 'invalid_input', error: '任务类型或输入范围不合法' }, { status: 400 })
  }
  if (!MODEL_PATTERN.test(model)) {
    return Response.json({ ok: false, error_code: 'invalid_model', error: '只允许固定 Claude Sonnet/Opus 模型 ID' }, { status: 400 })
  }

  setAutomationRunnerBusy(true)
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 330_000)
  try {
    let text = ''
    let actualModel = model
    let usage: unknown = null
    let structuredOutput: unknown
    const options: Options = {
      model,
      systemPrompt: taskType === 'weekly_journey'
        ? `${system}\n\n${WEEKLY_JOURNEY_TRANSPORT_INSTRUCTION}`
        : system,
      cwd: process.cwd(),
      maxTurns: 1,
      tools: [],
      allowedTools: [],
      mcpServers: {},
      strictMcpConfig: true,
      permissionMode: 'dontAsk',
      settingSources: [],
      includePartialMessages: false,
      abortController,
      env: buildCcEnv('subscription', { mainModel: model }),
    }
    if (taskType === 'weekly_journey') options.outputFormat = WEEKLY_JOURNEY_OUTPUT_FORMAT
    const stream = query({
      prompt: user,
      options,
    })
    for await (const message of stream) {
      if (message.type === 'system' && message.subtype === 'init') actualModel = message.model || model
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') text += block.text
        }
      }
      if (message.type === 'result') {
        usage = message.usage
        if (message.subtype !== 'success') {
          if (message.subtype === 'error_max_structured_output_retries') {
            throw new Error('Claude Pro structured output retries exhausted')
          }
          const detail = 'errors' in message ? message.errors.join('; ') : 'Claude Pro 执行失败'
          throw new Error(detail)
        }
        structuredOutput = message.structured_output
        if (!text.trim()) text = message.result
      }
    }
    if (taskType === 'weekly_journey') {
      text = JSON.stringify(restoreWeeklyJourneyCandidate(structuredOutput))
    }
    if (!text.trim()) throw new Error('Claude Pro 返回了空内容')
    return Response.json({ ok: true, text: text.trim(), task_type: taskType, model: actualModel, usage })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = errorCode(message)
    return Response.json(
      { ok: false, error_code: code, error: publicError(code) },
      { status: 502 },
    )
  } finally {
    clearTimeout(timeout)
    setAutomationRunnerBusy(false)
  }
}
