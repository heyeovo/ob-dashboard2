import { NextRequest } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildCcEnv, type CredMode } from '@/app/lib/ccEnv'

// 第 1 步最小验证：确认 Agent SDK 能在 Next.js 路由里起 claude code 子进程、
// Windows 路径正确、流能出来。不接 hook、不接对话存储、不给它碰文件。
//
// 额度维度和引擎维度是独立的，这里用 cred=api（中转站 / API 额度）。
// cred=subscription 分支留着：将来买了订阅，把那两个 ANTHROPIC_* 从子进程
// 环境里删掉即可，其余不变。两条路线并存，不是二选一。

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const prompt = sp.get('prompt') || '只回复两个字：收到'
  const cred: CredMode = sp.get('cred') === 'subscription' ? 'subscription' : 'api'
  const model = sp.get('model') || process.env.ANTHROPIC_MODEL || undefined

  const startedAt = Date.now()
  const events: Array<Record<string, unknown>> = []
  const stderrLines: string[] = []
  let initInfo: Record<string, unknown> | null = null
  let resultInfo: Record<string, unknown> | null = null
  let usageInfo: unknown = null
  let accountInfo: unknown = null
  let text = ''

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 110_000)

  try {
    const q = query({
      prompt,
      options: {
        model,
        cwd: process.cwd(),
        maxTurns: 1,
        allowedTools: [],           // 这一步不让它读写任何东西
        permissionMode: 'dontAsk',  // 未预批准的工具直接拒绝，不挂住等人
        settingSources: [],         // 隔离：不加载 ~/.claude 和项目 settings
        includePartialMessages: false,
        abortController: abort,
        env: buildCcEnv(cred, {
          baseUrl: sp.get('base_url') || undefined,
          authToken: sp.get('auth_token') || undefined,
          mainModel: model,
        }),
        stderr: (data) => {
          if (stderrLines.length < 40) stderrLines.push(data.trimEnd())
        },
      },
    })

    for await (const msg of q) {
      events.push({ at_ms: Date.now() - startedAt, type: msg.type, subtype: 'subtype' in msg ? msg.subtype : undefined })

      if (msg.type === 'system' && msg.subtype === 'init') {
        initInfo = {
          claude_code_version: msg.claude_code_version,
          model: msg.model,
          apiKeySource: msg.apiKeySource,
          cwd: msg.cwd,
          permissionMode: msg.permissionMode,
          session_id: msg.session_id,
          tools_count: msg.tools?.length ?? 0,
        }
        // subscription_type 只在这两个控制请求里拿得到，不在流式消息上
        try {
          const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
          usageInfo = {
            subscription_type: u.subscription_type,
            rate_limits_available: u.rate_limits_available,
            rate_limits: u.rate_limits,
            session: u.session,
          }
        } catch (e) {
          usageInfo = { error: String(e) }
        }
        try {
          accountInfo = await q.accountInfo()
        } catch (e) {
          accountInfo = { error: String(e) }
        }
      }

      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') text += block.text
        }
      }

      if (msg.type === 'result') {
        resultInfo = {
          subtype: msg.subtype,
          is_error: msg.is_error,
          num_turns: msg.num_turns,
          duration_ms: msg.duration_ms,
          duration_api_ms: msg.duration_api_ms,
          total_cost_usd: msg.total_cost_usd,
          usage: msg.usage,
          modelUsage: msg.modelUsage,
          result: msg.subtype === 'success' ? msg.result : undefined,
          errors: 'errors' in msg ? msg.errors : undefined,
        }
      }
    }

    return Response.json({
      ok: !!resultInfo && !resultInfo.is_error,
      cred_mode: cred,
      requested_model: model ?? null,
      upstream_base_url: cred === 'api'
        ? (sp.get('base_url') || process.env.ANTHROPIC_BASE_URL || null)
        : null,
      text,
      init: initInfo,
      // 用户当前只有 API key + 中转站，这里预期 subscription_type = null
      subscription_type:
        (usageInfo as { subscription_type?: unknown } | null)?.subscription_type ?? null,
      usage_probe: usageInfo,
      account_info: accountInfo,
      result: resultInfo,
      events,
      stderr: stderrLines,
      elapsed_ms: Date.now() - startedAt,
    })
  } catch (e) {
    const err = e as Error
    return Response.json({
      ok: false,
      cred_mode: cred,
      requested_model: model ?? null,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 12),
      events,
      stderr: stderrLines,
      elapsed_ms: Date.now() - startedAt,
    }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }
}
