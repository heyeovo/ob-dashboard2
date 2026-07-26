import { NextRequest } from 'next/server'
import type { SDKMessage, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk'
import { isDeniedPath, pathsFromToolInput, resolveDirs } from '@/app/lib/ccDirs'
import { buildCcEnv, type CredMode } from '@/app/lib/ccEnv'
import { buildPersonaAppend, getPersona, type HavenPersona } from '@/app/lib/havenPersonas'
import { recallForPrompt } from '@/app/lib/havenRecall'
import { recordTurn } from '@/app/lib/havenTurns'
import {
  ensureSession,
  dropSession,
  rememberResumePoint,
  getSessionStats,
} from '@/app/lib/ccSession'

// 第 4 步：聊天页的流式路由。
//
//   POST /api/cc-chat   body: { session_id, text, cred?, model?, semantic? }
//   → text/event-stream，逐字吐 delta
//
// 三条从前几步继承下来的硬约束：
//   1. sessionId 一个值贯穿全程 —— hook 送去 Haven 召回的、写库分组的、前端会话列表
//      认的都是它。分开了就变成召回按 A 分组、对话存进 B 分组，跨窗口注入会串。
//   2. 别一句一个 query() —— 每次启动固定烧 ≈$0.27 缓存写入。这里用 streaming input，
//      一个 query() 活到闲置回收（见 ccSession.ts）。
//   3. 送去召回的是用户原话全文。已知反向效应：prompt 越长语义分越低、召回越差
//      （第 2 步实测）。第一版**不做截取**，改成把召回结果回给前端显示，
//      真出现「时好时坏」时能立刻看到是哪一句。
//
// 第一版工具权限：只读（Read / Grep / Glob）。写文件和跑命令要等第 5 步的 diff 批准界面。

export const runtime = 'nodejs'
// ⚠️ 300 是 Vercel Hobby 计划的上限，写 600 会让线上部署直接失败
//（Build Failed: invalid maxDuration ... must be between 1 and 300）。
// 这个值只约束 Vercel 上的 serverless function，**本地 dev 不受它限制**，
// 所以长会话在本地不受影响。
// 而且这条路由在线上本来就跑不起来（serverless 没有 claude code 二进制、
// 不能长驻子进程）—— 真正的解法是让它不进线上构建，见 handoff 文档
// 「线上部署要处理的事」一节，导航重构那轮一起做。
export const maxDuration = 300

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

type ChatBody = {
  session_id?: string
  text?: string
  cred?: string
  model?: string
  semantic?: boolean
  /** 传 false 就不查记忆（调试用） */
  recall?: boolean
  /** 4.5b：用哪个协作者。提示词 / 记忆条目 / 两个召回开关 / 引擎都从它来 */
  persona_id?: string
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// 这个会话的两个召回开关。
//
// 为什么要一张表：下面那个 UserPromptSubmit hook 的闭包只在会话**第一轮**建起来，
// 直接捕获变量的话，之后改开关得等新对话才生效。放这里让 hook 每轮重读，
// 「注入 OB 记忆 / 语义检索」就能当场生效 —— 提示词和引擎做不到这点
// （那是子进程的启动参数，界面上也是这么写的）。
const recallPrefs = new Map<string, { recall: boolean; semantic: boolean }>()

export async function POST(request: NextRequest) {
  let body: ChatBody
  try {
    body = (await request.json()) as ChatBody
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const sessionId = (body.session_id || '').trim()
  const text = (body.text || '').trim()
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  if (!text) return Response.json({ ok: false, error: 'text 为空' }, { status: 400 })

  // 协作者：读不到就当没有，聊天照常（退回 claude code 自带的系统提示）。
  // 配置读不出来不该让人发不了话。
  let persona: HavenPersona | null = null
  if (body.persona_id) {
    const res = await getPersona(body.persona_id)
    persona = res.persona
  }

  // 引擎 → 额度。selfhost 是第 7 步的自建引擎，走到这里一律按中转站算。
  const engine = persona?.engine || ''
  const credFromEngine: CredMode = engine === 'subscription' ? 'subscription' : 'api'
  // body 里显式传的优先（调试用），否则听协作者
  const cred: CredMode = body.cred === 'subscription'
    ? 'subscription'
    : body.cred === 'api'
      ? 'api'
      : credFromEngine
  const model = body.model || process.env.ANTHROPIC_MODEL || undefined

  // 两个召回开关同样是 body 优先、协作者兜底，存进表让 hook 每轮重读
  recallPrefs.set(sessionId, {
    recall: body.recall !== undefined ? body.recall !== false : persona?.recall_on !== false,
    semantic: body.semantic !== undefined ? body.semantic !== false : persona?.semantic_on !== false,
  })

  const personaAppend = buildPersonaAppend(persona)
  // 能读哪些目录：协作者自己配的，没配就是仓库根。
  // 敏感文件的拦截跟这个无关，是下面 PreToolUse 那道硬规则。
  const { cwd, additionalDirectories } = resolveDirs(persona?.dirs)

  const encoder = new TextEncoder()
  const startedAt = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sse(event, data)))
        } catch {
          closed = true
        }
      }

      // 这一轮的记录
      let assistantText = ''
      let thinkingText = ''
      let recallInfo: Record<string, unknown> | null = null
      const toolEvents: Array<Record<string, unknown>> = []
      let resultInfo: Record<string, unknown> | null = null
      let initInfo: Record<string, unknown> | null = null

      const buildOptions = (resumeFrom: string | null): Options => ({
        model,
        // 协作者的人设接在 claude code 自带系统提示**后面**，不替换它 ——
        // 那段里有工具怎么用、路径怎么写，换掉工具就废了。
        // append 为空时不带这个键，保持第 4 步的行为不变。
        systemPrompt: personaAppend
          ? { type: 'preset', preset: 'claude_code', append: personaAppend }
          : { type: 'preset', preset: 'claude_code' },
        cwd,
        additionalDirectories,
        allowedTools: READ_ONLY_TOOLS,
        // 只读工具直接放行，其余一律拒。第 5 步换成 canUseTool 挂长连接等用户点按钮。
        permissionMode: 'dontAsk',
        settingSources: [],
        includePartialMessages: true,
        resume: resumeFrom || undefined,
        env: buildCcEnv(cred),
        hooks: {
          // 敏感文件硬拦。不是配置项，没有放行开关，任何协作者都一样。
          //
          // 为什么不做成「开放目录时问一次」：那是一次性决定，之后每个对话都按它走。
          // 而真正的风险点不是「读到」，是读到之后内容进了上下文 —— 上下文要发去
          // 中转站，那一刻密钥就出门了，事后撤不回来。
          PreToolUse: [
            {
              hooks: [
                async input => {
                  const { tool_name: toolName, tool_input: toolInput } =
                    input as { tool_name?: string; tool_input?: unknown }
                  const hit = pathsFromToolInput(toolInput).find(isDeniedPath)
                  if (!hit) return {}
                  const item = { name: String(toolName || '工具'), id: `deny-${Date.now()}`, denied: hit }
                  toolEvents.push(item)
                  send('tool', item)
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason:
                        `这个路径含密钥/凭据，前端一律不给读（${hit}）。` +
                        '需要里面的值就直接问用户，别自己找别的路子读。',
                    },
                  }
                },
              ],
            },
          ],
          UserPromptSubmit: [
            {
              // Haven 开语义检索单次 4-6 秒，给 30 秒余量。超时 SDK 放弃这个 hook
              // 继续走对话，不会卡死。
              timeout: 30,
              hooks: [
                async (input, _toolUseId, { signal }) => {
                  // 每轮重读，所以开关改完当场生效（这个闭包只在第一轮建）
                  const prefs = recallPrefs.get(sessionId)
                  if (prefs && !prefs.recall) return {}
                  const prompt = (input as { prompt?: string }).prompt || ''
                  const recall = await recallForPrompt(prompt, {
                    sessionId,
                    semantic: prefs ? prefs.semantic : true,
                    signal,
                  })
                  recallInfo = {
                    ok: recall.ok,
                    error: recall.error || undefined,
                    card_count: recall.cardCount,
                    chars: recall.chars,
                    elapsed_ms: recall.elapsedMs,
                    domains: recall.domains,
                    recalled_ids: recall.recalledIds,
                    injected: recall.ok && recall.chars > 0,
                  }
                  // 前端顶部要显示「这一轮召回了几条 / 多少字」，作为「召回时好时坏」
                  // 的现场证据。注入正文暂不回传（下一轮做存库 + 点开查看）。
                  send('recall', recallInfo)
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
        stderr: () => {
          /* 聊天路径不回传 stderr，排查用 /api/cc-hook-test */
        },
      })

      const live = ensureSession({ sessionId, buildOptions })

      if (live.busy) {
        send('error', { message: '这个会话上一轮还没跑完' })
        controller.close()
        return
      }
      live.busy = true
      live.lastModelCallAt = Date.now()

      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      }

      try {
        live.push(userMessage)
        send('start', { session_id: sessionId, at: startedAt })

        // 一个 query() 跨多轮，所以这里读到 result 就停 —— 那是「这一轮」的边界。
        // iterator 留着不关，下一句继续从它读。
        for (;;) {
          const step = await live.iterator.next()
          if (step.done) break
          const msg = step.value as SDKMessage

          if (msg.type === 'system' && msg.subtype === 'init') {
            initInfo = {
              claude_code_version: msg.claude_code_version,
              model: msg.model,
              cwd: msg.cwd,
              session_id: msg.session_id,
            }
            live.ccSessionId = msg.session_id
            rememberResumePoint(sessionId, msg.session_id)
            send('init', initInfo)
            continue
          }

          // 逐字：includePartialMessages 打开后走 stream_event
          if (msg.type === 'stream_event') {
            const ev = msg.event as {
              type?: string
              delta?: { type?: string; text?: string; thinking?: string }
            }
            if (ev.type === 'content_block_delta' && ev.delta) {
              if (ev.delta.type === 'text_delta' && ev.delta.text) {
                assistantText += ev.delta.text
                send('delta', { text: ev.delta.text })
              } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
                thinkingText += ev.delta.thinking
                send('thinking', { text: ev.delta.thinking })
              }
            }
            continue
          }

          if (msg.type === 'assistant') {
            for (const block of msg.message.content) {
              if (block.type === 'tool_use') {
                const item = {
                  name: block.name,
                  id: block.id,
                  input: block.input,
                }
                toolEvents.push(item)
                send('tool', item)
              }
            }
            continue
          }

          if (msg.type === 'result') {
            resultInfo = {
              subtype: msg.subtype,
              is_error: msg.is_error,
              num_turns: msg.num_turns,
              duration_ms: msg.duration_ms,
              total_cost_usd: msg.total_cost_usd,
              usage: msg.usage,
            }
            // result 里的 result 字段是这一轮的完整文本，用它兜底
            if (msg.subtype === 'success' && !assistantText.trim()) {
              assistantText = msg.result
            }
            live.totalCostUsd += Number(msg.total_cost_usd || 0)
            live.turnCount += 1
            live.lastModelCallAt = Date.now()
            break
          }
        }

        // ── 写回 Haven 的 conversation_turns ────────────────────────────
        // sessionId 跟 hook 用的是同一个值（同一个变量），不会分组串。
        let storeInfo: Record<string, unknown>
        if (assistantText.trim()) {
          const rec = await recordTurn({
            sessionId,
            userText: text,
            assistantText,
            model: String(initInfo?.model || model || ''),
            // client 里带上协作者 id：会话列表接口只回 client 不回 raw_json，
            // 靠它做「这个对话属于谁」的过滤，不用为此再改一次 Haven。
            // 这一列只有这条路由写，没别人读，可以这么用。权威记录仍是下面 raw.persona_id。
            client: persona?.id ? `ob2-chat/${persona.id}` : 'ob2-chat',
            route: '/api/cc-chat',
            source: 'cc',
            raw: {
              engine: 'claude-code-agent-sdk',
              cred_mode: cred,
              persona_id: persona?.id || undefined,
              persona_name: persona?.name || undefined,
              thinking: thinkingText || undefined,
              recall: recallInfo,
              tools: toolEvents,
              result: resultInfo,
            },
          })
          storeInfo = {
            ok: rec.ok,
            stored: rec.stored,
            turn_id: rec.turnId,
            round_id: rec.roundId,
            error: rec.error || undefined,
          }
        } else {
          storeInfo = { ok: false, stored: false, error: '模型没有文本输出，不写库' }
        }

        send('done', {
          result: resultInfo,
          store: storeInfo,
          stats: getSessionStats(sessionId),
          elapsed_ms: Date.now() - startedAt,
        })
      } catch (e) {
        const err = e as Error
        // 子进程崩了 / 流坏了：这个会话的 iterator 已经不可用，收掉重来
        dropSession(sessionId)
        send('error', { message: err.message || String(err) })
      } finally {
        live.busy = false
        closed = true
        try {
          controller.close()
        } catch {
          /* 已经关了 */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** 拿会话的实时状态（费用、缓存剩余时间）。前端顶部轮询用。 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  return Response.json({ ok: true, stats: getSessionStats(sessionId) })
}

/** 主动收掉一个会话的子进程（切走会话 / 想重新开始时用）。 */
export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })
  dropSession(sessionId)
  recallPrefs.delete(sessionId)
  return Response.json({ ok: true })
}
