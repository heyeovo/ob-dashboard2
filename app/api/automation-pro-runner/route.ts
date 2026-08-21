import { timingSafeEqual } from 'node:crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildCcEnv } from '@/app/lib/ccEnv'

export const runtime = 'nodejs'
export const maxDuration = 360

const TASKS = new Set(['daily_review', 'weekly_journey'])
const MODEL_PATTERN = /^claude-(?:sonnet|opus)-[a-z0-9-]+$/i
const LOCK_KEY = '__ob2_automation_pro_runner_busy__'

type RunnerGlobal = typeof globalThis & { [LOCK_KEY]?: boolean }

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
  return 'pro_runner_failed'
}

function publicError(code: string) {
  if (code === 'pro_limit') return 'Claude Pro 额度不足或正在限流'
  if (code === 'pro_auth') return 'Claude Pro 登录已失效，需要人工重新登录'
  if (code === 'pro_timeout') return 'Claude Pro 自动化执行超时'
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

  const globalRunner = globalThis as RunnerGlobal
  if (globalRunner[LOCK_KEY]) {
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

  globalRunner[LOCK_KEY] = true
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 330_000)
  try {
    let text = ''
    let actualModel = model
    let usage: unknown = null
    const stream = query({
      prompt: user,
      options: {
        model,
        systemPrompt: system,
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
      },
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
        if (message.is_error) {
          const detail = 'errors' in message ? message.errors.join('; ') : 'Claude Pro 执行失败'
          throw new Error(detail)
        }
        if (!text.trim() && message.subtype === 'success') text = message.result
      }
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
    globalRunner[LOCK_KEY] = false
  }
}
