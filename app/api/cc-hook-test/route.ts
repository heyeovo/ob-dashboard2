import { NextRequest } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { UserPromptSubmitHookInput } from '@anthropic-ai/claude-agent-sdk'
import { buildCcEnv, type CredMode } from '@/app/lib/ccEnv'
import { recallForPrompt, type HavenRecallResult } from '@/app/lib/havenRecall'
import { recordTurn } from '@/app/lib/havenTurns'

// 第 2 步验证：UserPromptSubmit hook → Haven /api/hook/recall → additionalContext。
//
// 判断注入有没有生效看两个独立信号：
//   1. hook_calls[].recall —— Haven 到底返了几张卡、多少字（这是客观事实）
//   2. text —— 模型自己说有没有收到（这是"真的进了 prompt"的证据）
// 两个都要看：只有 1 说明 Haven 通了但不一定进了 prompt；只有 2 不可信。
//
// 第 1 步的 /api/cc-test 保持原样不动，出问题时可以回归对比。
//
// 第 3 步追加：整轮跑完后把这一轮写回 Haven 的 conversation_turns（source='cc'，
// raw_json 存 SDK 原始事件摘要）。写的是**现有那张表**，所以跨窗口注入、date_recall、
// 人格引擎取近期对话立刻能看到 cc 引擎产生的对话。加 ?store=0 可以跳过写库。

export const runtime = 'nodejs'
export const maxDuration = 180

// ⚠️ 这句措辞是实测过能召回的（2 张卡 / 1382 字）。两个坑都踩过：
//   1. 换成"我的记忆系统是怎么设计的"那种 → 候选全是 semantic_only，0 卡
//   2. 在这句后面追加任何说明性指令 → 整条 prompt 被稀释，语义分从过闸掉到
//      0.39，所有候选变成 blocked: discriminative_anchor_missing，同样 0 卡
// hook 拿到的是**整条** prompt 原文，所以给模型的额外指令必须走 systemPrompt
// append，不能拼在用户这句话里。换测试句请先单独打一次 Haven 确认能出卡。
const DEFAULT_PROMPT = '帮我回忆一下我们关于记忆系统的讨论'

// 让模型自报有没有收到注入 —— 这是"真的进了 prompt"的独立证据。
// 放在 system prompt 里，不污染 hook 送去 Haven 的 query。
const REPORT_INSTRUCTION =
  '回答前先单独用一行报告注入情况：如果这一轮 prompt 里有额外注入给你的记忆内容，' +
  '写「有注入：」加上你看到的第一条记忆的标题；如果完全没有，只写「无注入」。' +
  '然后再正常回答。不要使用任何工具。'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const prompt = sp.get('prompt') || DEFAULT_PROMPT
  const cred: CredMode = sp.get('cred') === 'subscription' ? 'subscription' : 'api'
  const model = sp.get('model') || process.env.ANTHROPIC_MODEL || undefined
  // session_id 就是 Haven 分组用的那个 header 值。不传就用 claude code 自己的
  // session_id（hook 输入里带），保证一个对话前后是同一组。
  const forcedSessionId = sp.get('session_id') || undefined
  const semantic = sp.get('semantic') !== '0'
  const includeDebug = sp.get('debug') === '1'
  const store = sp.get('store') !== '0'

  const startedAt = Date.now()
  const events: Array<Record<string, unknown>> = []
  const stderrLines: string[] = []
  const hookCalls: Array<Record<string, unknown>> = []
  let initInfo: Record<string, unknown> | null = null
  let resultInfo: Record<string, unknown> | null = null
  let text = ''
  // 写库用的分组键，跟 hook 送去 Haven 的那个必须是同一个值，
  // 否则召回按 A 分组、对话存进 B 分组，跨窗口注入就串了。
  let effectiveSessionId = forcedSessionId || ''

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 170_000)

  try {
    const q = query({
      prompt,
      options: {
        model,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: REPORT_INSTRUCTION,
        },
        cwd: process.cwd(),
        maxTurns: 1,
        allowedTools: [],           // 这一步还不让它碰文件
        permissionMode: 'dontAsk',
        settingSources: [],         // 不加载 ~/.claude 和项目 settings，只用这里给的 hook
        includePartialMessages: false,
        abortController: abort,
        env: buildCcEnv(cred, {
          baseUrl: sp.get('base_url') || undefined,
          authToken: sp.get('auth_token') || undefined,
        }),
        hooks: {
          UserPromptSubmit: [
            {
              // Haven 开了语义检索单次 4-6 秒，给 30 秒余量。超时 SDK 会放弃这个
              // hook 继续走对话，不会卡死。
              timeout: 30,
              hooks: [
                async (input, _toolUseId, { signal }) => {
                  const hookInput = input as UserPromptSubmitHookInput
                  const sessionId = forcedSessionId || hookInput.session_id || 'cc-hook-test'
                  effectiveSessionId = sessionId
                  let recall: HavenRecallResult
                  try {
                    recall = await recallForPrompt(hookInput.prompt, {
                      sessionId,
                      semantic,
                      includeDebug,
                      signal,
                    })
                  } catch (e) {
                    // recallForPrompt 自己不抛，这里是最后一道保险
                    hookCalls.push({
                      at_ms: Date.now() - startedAt,
                      session_id: sessionId,
                      thrown: String(e),
                    })
                    return {}
                  }

                  hookCalls.push({
                    at_ms: Date.now() - startedAt,
                    session_id: sessionId,
                    prompt_seen: hookInput.prompt.slice(0, 80),
                    semantic,
                    recall_ok: recall.ok,
                    recall_error: recall.error || undefined,
                    http_status: recall.httpStatus,
                    card_count: recall.cardCount,
                    chars: recall.chars,
                    recall_ms: recall.elapsedMs,
                    domains: recall.domains,
                    recalled_ids: recall.recalledIds,
                    injected: recall.ok && recall.chars > 0,
                    additional_context: recall.additionalContext,
                    debug: recall.debug,
                  })

                  if (!recall.ok || !recall.additionalContext) return {}
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'UserPromptSubmit' as const,
                      additionalContext: recall.additionalContext,
                    },
                  }
                },
              ],
            },
          ],
        },
        stderr: (data) => {
          if (stderrLines.length < 40) stderrLines.push(data.trimEnd())
        },
      },
    })

    for await (const msg of q) {
      events.push({
        at_ms: Date.now() - startedAt,
        type: msg.type,
        subtype: 'subtype' in msg ? msg.subtype : undefined,
      })

      if (msg.type === 'system' && msg.subtype === 'init') {
        initInfo = {
          claude_code_version: msg.claude_code_version,
          model: msg.model,
          cwd: msg.cwd,
          session_id: msg.session_id,
          permissionMode: msg.permissionMode,
        }
        // hook 没触发时的兜底（比如 hook 超时），保证写库还有分组键
        if (!effectiveSessionId) effectiveSessionId = msg.session_id
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
          total_cost_usd: msg.total_cost_usd,
          usage: msg.usage,
          result: msg.subtype === 'success' ? msg.result : undefined,
          errors: 'errors' in msg ? msg.errors : undefined,
        }
      }
    }

    const injected = hookCalls.some((c) => c.injected === true)

    // ── 第 3 步：写回 conversation_turns ────────────────────────────────
    // 只在整轮成功且有回复时写。round_id 交给 Haven 自己接（同 session MAX+1）。
    let storeInfo: Record<string, unknown> | null = null
    const sessionIdForStore = effectiveSessionId || 'cc-hook-test'
    if (store && resultInfo && !resultInfo.is_error && text.trim()) {
      const rec = await recordTurn({
        sessionId: sessionIdForStore,
        userText: prompt,
        assistantText: text,
        model: String(initInfo?.model || model || ''),
        client: 'cc-hook-test',
        route: '/api/cc-hook-test',
        source: 'cc',
        // 原始 JSON 原样留一份：这一轮的 SDK 事件序列 + 注入了什么 + 用量。
        // 将来发现转换丢了东西（工具调用、附件）能从这里重来。
        raw: {
          engine: 'claude-code-agent-sdk',
          cred_mode: cred,
          prompt,
          init: initInfo,
          result: resultInfo,
          events,
          hook_calls: hookCalls,
        },
      })
      storeInfo = {
        attempted: true,
        ok: rec.ok,
        stored: rec.stored,
        turn_id: rec.turnId,
        round_id: rec.roundId,
        session_id: sessionIdForStore,
        elapsed_ms: rec.elapsedMs,
        error: rec.error || undefined,
        http_status: rec.httpStatus,
      }
    } else {
      storeInfo = {
        attempted: false,
        reason: !store
          ? 'store=0'
          : !resultInfo || resultInfo.is_error
            ? '这一轮没成功'
            : '模型没有文本输出',
        session_id: sessionIdForStore,
      }
    }

    return Response.json({
      ok: !!resultInfo && !resultInfo.is_error,
      hook_fired: hookCalls.length > 0,
      injected,
      injected_chars: hookCalls.reduce((n, c) => n + Number(c.chars || 0), 0),
      // injected=false 时先看这里：hook 通了但 Haven 返 0 卡，多半是 prompt 措辞
      // 被门控挡了（长指令会拉低语义分），不是链路问题。加 ?debug=1 看 blocked_reason。
      hint:
        hookCalls.length > 0 && !injected
          ? 'hook 已触发但 Haven 返回 0 卡。加 ?debug=1 看 hook_calls[].debug.suppressed_bucket_candidates 里的 blocked_reason；prompt 越长语义分越低。'
          : undefined,
      prompt,
      cred_mode: cred,
      requested_model: model ?? null,
      semantic,
      text,
      store: storeInfo,
      hook_calls: hookCalls,
      init: initInfo,
      result: resultInfo,
      events,
      stderr: stderrLines,
      elapsed_ms: Date.now() - startedAt,
    })
  } catch (e) {
    const err = e as Error
    return Response.json(
      {
        ok: false,
        hook_fired: hookCalls.length > 0,
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 12),
        hook_calls: hookCalls,
        events,
        stderr: stderrLines,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 },
    )
  } finally {
    clearTimeout(timer)
  }
}
