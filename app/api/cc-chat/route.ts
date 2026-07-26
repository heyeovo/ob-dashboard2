import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { SDKMessage, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk'
import {
  attachSend,
  detachSend,
  emit,
  autoAllowEdits,
  recordCheckpoint,
  recordCommand,
  recordFileChange,
  requestPermission,
  resetChannel,
  turnSnapshot,
  type CcPermKind,
} from '@/app/lib/ccChannel'
import { diffForEdit, diffForWrite, diffPlaceholder } from '@/app/lib/ccDiff'
import {
  EXEC_TOOLS,
  GREP_EXCLUDE_GLOB,
  WRITE_TOOLS,
  isDeniedPath,
  isWritablePath,
  pathsFromToolInput,
  resolveDirs,
  resolveWriteDirs,
  scrubDeniedLines,
} from '@/app/lib/ccDirs'
import { buildCcEnv, type CredMode } from '@/app/lib/ccEnv'
import { buildPersonaAppend, getPersona, type HavenPersona } from '@/app/lib/havenPersonas'
import { recallForPrompt } from '@/app/lib/havenRecall'
import { recordTurn } from '@/app/lib/havenTurns'
import { loadUpstreamConfig, resolveProvider } from '@/app/lib/havenUpstream'
import {
  ensureSession,
  dropSession,
  rememberResumePoint,
  getSessionStats,
  recordTurnCost,
  noteContextUsage,
  type TurnUsage,
} from '@/app/lib/ccSession'
import { CHAT_MODE_PROMPT, isCcMode, type CcMode } from '@/app/lib/ccModes'

// 聊天页的流式路由（第 4 步建，第 5 步加写权限）。
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
// ── 第 5 步加的三件事 ─────────────────────────────────────────────
//
//   写权限：Write / Edit / NotebookEdit / Bash 不再一律拒，走 canUseTool 停住
//           等浏览器点批准（队列在 ccChannel.ts，不在这个闭包里）
//
//   ⚠️ 为什么 hook 和 canUseTool 都不能直接用下面那个 `send`：
//   buildOptions **只在会话第一轮**跑一次（ccSession.ts 里已有会话就复用），
//   所以闭包里的 send 永远是第一轮那个流的。第 2 轮起推进去全落进已关闭的流 ——
//   4.5b 那个「召回信息第二轮不刷新、写库的 raw.recall 是空的」就是这么来的。
//   现在统一走 ccChannel 的 emit：每轮开头 attachSend、结尾 detachSend。
//
//   同理，`recallInfo` / `toolEvents` 这些**当轮变量**也不能在 hook 里直接写，
//   要经 turnRef 拿「当前这一轮」的那份。

export const runtime = 'nodejs'
// ⚠️ 300 是 Vercel Hobby 计划的上限，写 600 会让线上部署直接失败
//（Build Failed: invalid maxDuration ... must be between 1 and 300）。
// 这个值只约束 Vercel 上的 serverless function，**本地 dev 不受它限制**，
// 所以长会话在本地不受影响。
// 而且这条路由在线上本来就跑不起来（serverless 没有 claude code 二进制、
// 不能长驻子进程）—— 真正的解法是让它不进线上构建，见 handoff 文档
// 「线上部署要处理的事」一节，导航重构那轮一起做。
export const maxDuration = 300

/** 直接放行、不弹批准卡的只读工具。 */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

/**
 * 模型手上有哪些工具。
 *
 * 只列这几个而不是给 preset 全套：TodoWrite / WebSearch / Agent 那些在这个
 * 界面里没有对应的显示，出现了只会让人看不懂发生了什么。要加是以后的事
 *（MCP 是第 7 步）。
 */
const SESSION_TOOLS = [...READ_ONLY_TOOLS, ...WRITE_TOOLS, 'Bash']

/** 这一轮的收集口。hook 和 canUseTool 都从 turnRef.current 拿，不捕获局部变量。 */
type TurnBucket = {
  recallInfo: Record<string, unknown> | null
  toolEvents: Array<Record<string, unknown>>
}

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
  /** 5.2：chat = 闲聊（零工具），work = 工作。只在会话第一轮生效 */
  mode?: string
  /** 5.2：哪个中转站（api 时）。只在第一轮生效，服务端翻成 baseUrl + token */
  provider_id?: string
  /** 5.2：reasoning effort。第一轮生效，之后走 /api/cc-session-settings 中途改 */
  effort?: string
  /** 5.2：开不开 thinking */
  thinking?: boolean
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

/**
 * 这个会话「当前那一轮」的收集口，和上面那张表同一个道理：
 * hook 的闭包是第一轮建的，要拿到第 N 轮的 recallInfo / toolEvents 就得每轮重查。
 */
const turnBuckets = new Map<string, TurnBucket>()

/** 这个会话能写哪些目录。同样每轮重读 —— 改完配置开新对话生效，跟提示词一致。 */
const writeDirsBySession = new Map<string, string[]>()

function toolKind(toolName: string): CcPermKind {
  if (toolName === 'Edit' || toolName === 'NotebookEdit') return 'edit'
  if (toolName === 'Write') return 'write'
  if (EXEC_TOOLS.includes(toolName)) return 'bash'
  return 'other'
}

/**
 * 往「这一轮」的工具记录里加一条，同时推给前端。
 * hook 里必须用这个，不能碰局部变量 —— 见文件头那段说明。
 */
function pushToolEvent(sessionId: string, item: Record<string, unknown>) {
  turnBuckets.get(sessionId)?.toolEvents.push(item)
  emit(sessionId, 'tool', item)
}

/** 从工具结果里抠出文本。不同工具的 tool_response 形状不一样，都兜一下。 */
function toolResponseText(res: unknown): string {
  if (typeof res === 'string') return res
  if (!res || typeof res !== 'object') return ''
  const r = res as Record<string, unknown>
  for (const key of ['stdout', 'output', 'text', 'content', 'result']) {
    const v = r[key]
    if (typeof v === 'string') return v
  }
  if (Array.isArray(r.content)) {
    return r.content
      .map(b => (b && typeof b === 'object' ? String((b as Record<string, unknown>).text || '') : ''))
      .join('\n')
  }
  return ''
}

/** 数一下 Edit / Write 实际动了多少行，工作台「改了哪些文件」那格要显示。 */
function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

/**
 * result 事件里的 usage → 消息右下角那个面板要显示的几个数（5.2）。
 *
 * 缓存写入分两档，`cache_creation` 里分开给：
 *   ephemeral_1h_input_tokens = 系统提示那部分（cc 自己判定它最稳定）
 *   ephemeral_5m_input_tokens = 会话消息那部分
 * 加起来才等于 cache_creation_input_tokens。分开显示的意义在于：5 分钟一过
 * 只有后者失效，前者还活着，接着聊仍然便宜。
 */
function usageFromResult(
  usage: unknown,
  durationMs: number | undefined,
  costUsd: number | undefined,
): TurnUsage {
  const u = (usage || {}) as Record<string, unknown>
  const creation = (u.cache_creation || {}) as Record<string, unknown>
  const num = (v: unknown) => Number(v || 0) || 0
  const outputTokens = num(u.output_tokens)
  const ms = Number(durationMs || 0) || 0
  return {
    inputTokens: num(u.input_tokens),
    outputTokens,
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
    cacheWrite1hTokens: num(creation.ephemeral_1h_input_tokens),
    cacheWrite5mTokens: num(creation.ephemeral_5m_input_tokens),
    durationMs: ms,
    tokensPerSec: ms > 0 ? Math.round((outputTokens / (ms / 1000)) * 10) / 10 : 0,
    costUsd: Number(costUsd || 0) || 0,
  }
}

/** 写库最多等这么久，超了就放弃这一轮的存档，不拖着对话 */
const STORE_TIMEOUT_MS = 8000

/**
 * 等一个 promise，超时就返回 fallback。
 * ⚠️ 只是不再等它，原来那个 promise 还在后台跑（写库该写的还会写进去）。
 */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      // 超时之后它才炸的话没人接，会变成 unhandled rejection，先接住
      p.catch(() => fallback),
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function POST(request: NextRequest) {
  // 计时基点放在最前面 —— 读协作者配置要去 Zeabur，那一步也算「等回复」的时间
  const reqAt = Date.now()
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
  // body 里显式传的优先（本窗口设置选的），否则听协作者
  const cred: CredMode = body.cred === 'subscription'
    ? 'subscription'
    : body.cred === 'api'
      ? 'api'
      : credFromEngine

  // 5.2 闲聊 / 工作。默认工作 —— 4.5b 之前的老会话和不带这个字段的调用都按老行为走。
  const mode: CcMode = isCcMode(body.mode) ? body.mode : 'work'

  // 5.2 上游：走 Haven 那份「上游模型配置」。
  // ⚠️ token 只在服务端出现，前端送的是 provider_id。读不到配置就退回 .env.local
  // 那一条（第 4 步起的行为），不能让聊天页因为配置拿不到就发不了话。
  let providerId = ''
  let providerLabel = ''
  let envOverrides: { baseUrl?: string; authToken?: string } = {}
  let model = body.model || ''
  let effort = String(body.effort || '')
  let thinking = body.thinking !== false
  if (cred === 'api') {
    const up = await loadUpstreamConfig()
    if (up.ok) {
      const hit = resolveProvider(up.config, String(body.provider_id || ''))
      if (hit) {
        providerId = String(body.provider_id || up.config.default_provider_id || '')
        providerLabel = hit.label
        envOverrides = { baseUrl: hit.baseUrl, authToken: hit.authToken }
      }
      if (!model) model = String(up.config.default_model || '')
      if (!effort) effort = String(up.config.default_effort || '')
    }
  }
  if (!model) model = process.env.ANTHROPIC_MODEL || ''

  // 两个召回开关同样是 body 优先、协作者兜底，存进表让 hook 每轮重读
  recallPrefs.set(sessionId, {
    recall: body.recall !== undefined ? body.recall !== false : persona?.recall_on !== false,
    semantic: body.semantic !== undefined ? body.semantic !== false : persona?.semantic_on !== false,
  })

  const personaAppend = buildPersonaAppend(persona)
  // 能读哪些目录：协作者自己配的，没配就是仓库根。
  // 敏感文件的拦截跟这个无关，是下面 PreToolUse 那道硬规则。
  const { cwd, additionalDirectories } = resolveDirs(persona?.dirs)
  // 能写哪些目录：另一份更窄的清单，**空 = 一个字都不许写**（跟读的规则相反）。
  // 每轮重存，所以配置改完立刻生效 —— 不像提示词要等新对话。
  const writeDirs = resolveWriteDirs(persona?.write_dirs)
  writeDirsBySession.set(sessionId, writeDirs)

  const encoder = new TextEncoder()
  const startedAt = reqAt

  // 慢在哪一段：每个节点打一行「距开始多少毫秒」到 dev 控制台。
  // 前半段（发出去半天不出字）多半是召回要去 Zeabur 查，跟模型无关，靠这几行能分清。
  let lastStampAt = startedAt
  const stamp = (label: string) => {
    const now = Date.now()
    console.log(
      `[cc-chat ${sessionId.slice(0, 8)}] ${label} +${now - startedAt}ms (上一步用了 ${now - lastStampAt}ms)`,
    )
    lastStampAt = now
  }
  stamp('配置读完（协作者 / 目录，这一步要去 Zeabur）')

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

      // 这一轮的记录。
      // ⚠️ recallInfo / toolEvents 放进 turnBuckets，不留在这个闭包里 ——
      // hook 是第一轮建的，只有走那张表才拿得到「当前这一轮」的那份。
      let assistantText = ''
      let thinkingText = ''
      let resultInfo: Record<string, unknown> | null = null
      let initInfo: Record<string, unknown> | null = null
      /** 这一轮的用量，消息右下角那个面板要显示 */
      let turnUsage: TurnUsage | null = null
      const bucket: TurnBucket = { recallInfo: null, toolEvents: [] }
      turnBuckets.set(sessionId, bucket)
      // 这一轮的 SSE 口挂到 channel 上，hook / canUseTool 都经它推事件
      attachSend(sessionId, send)

      /**
       * 写文件 / 跑命令之前停在这里，等浏览器点按钮。
       *
       * ⚠️ 这个回调也是第一轮建的，所以里面**只用 sessionId 去查**当前状态
       *（写目录、放行开关），不捕获任何当轮变量。
       *
       * 挂住期间：那一轮的 for-await 停着不动，子进程不会被回收（ccSession 里
       * hasPending 会让闲置计时器顺延）。30 分钟没人点就按拒绝收场。
       */
      const askPermission: NonNullable<Options['canUseTool']> = async (toolName, input, meta) => {
        const kind = toolKind(toolName)
        const dirs = writeDirsBySession.get(sessionId) || []
        const filePath = String(
          (input as Record<string, unknown>).file_path ||
            (input as Record<string, unknown>).notebook_path ||
            '',
        )

        // 写清单之外的一律硬拒，不弹卡片 —— 这不是「要不要批准」的问题，
        // 是根本没配。空清单时这里会拒掉所有写操作，界面上会提示去哪加。
        if (WRITE_TOOLS.includes(toolName) && !isWritablePath(filePath, dirs)) {
          return {
            behavior: 'deny',
            message: dirs.length
              ? `这个路径不在允许写的目录里（${filePath}）。能写的是：${dirs.join('、')}。` +
                '别改别处的文件，也别绕道用命令写。'
              : '这个协作者还没配「能写哪些目录」，所以现在一个文件都不能改。' +
                '把你想改什么、改成什么说出来，让用户自己决定要不要开写权限。',
          }
        }

        // 「本会话 Edit / Write 都放行」。⚠️ 只覆盖改文件，Bash 永远问。
        if (WRITE_TOOLS.includes(toolName) && autoAllowEdits(sessionId)) {
          return { behavior: 'allow' }
        }

        // diff / 命令原文由服务端拼好，前端只渲染
        let diff = null
        if (toolName === 'Edit') diff = await diffForEdit(input as Record<string, unknown>)
        else if (toolName === 'Write') diff = await diffForWrite(input as Record<string, unknown>)
        else if (toolName === 'NotebookEdit') {
          diff = diffPlaceholder(filePath, 'notebook 改动没有行级预览，看下面的参数')
        }

        const decision = await requestPermission(sessionId, {
          id: meta.requestId,
          toolName,
          kind,
          // SDK 自己渲染好的那句话优先（.d.ts 里明说别自己拼）
          title: meta.title || `${toolName} 要执行一个操作`,
          description: meta.description || meta.decisionReason || '',
          filePath,
          command: String((input as Record<string, unknown>).command || ''),
          diff,
        })
        return decision.behavior === 'allow'
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: decision.message }
      }

      const buildOptions = (resumeFrom: string | null): Options => ({
        model: model || undefined,
        effort: (effort || undefined) as Options['effort'],
        maxThinkingTokens: thinking ? undefined : 0,
        // 工作模式：协作者人设接在 claude code 自带系统提示**后面**，不替换它 ——
        //   那段里有工具怎么用、路径怎么写，换掉工具就废了。
        // 闲聊模式：整段替换成用户自己写的那段（见 ccModes.ts），人设照旧接在后面 ——
        //   不接的话切协作者就没意义了（谁都一样）。
        systemPrompt:
          mode === 'chat'
            ? [CHAT_MODE_PROMPT, personaAppend].filter(Boolean).join('\n\n')
            : personaAppend
              ? { type: 'preset', preset: 'claude_code', append: personaAppend }
              : { type: 'preset', preset: 'claude_code' },
        cwd,
        additionalDirectories,
        // 闲聊模式零工具。以后接的 MCP 要给（那是记忆 / 联网），但 cc 这 7 个不给 ——
        // 不然它会去读文件，而闲聊模式的 prompt 里没有"怎么用工具"那套规矩。
        tools: mode === 'chat' ? [] : SESSION_TOOLS,
        // 只读的三个自动放行；写和跑命令**不在**这里，于是落到 canUseTool 上等批准。
        allowedTools: mode === 'chat' ? [] : READ_ONLY_TOOLS,
        // 'default' 而不是第 4 步那个 'dontAsk' —— dontAsk 会把没预批的直接拒掉，
        // 根本走不到 canUseTool，也就没有批准这回事了。
        permissionMode: 'default',
        canUseTool: askPermission,
        // 回退点要它：把改动前的文件备份下来，rewindFiles 才有东西可还原。
        // ⚠️ 备份活在子进程里，进程被回收后这些点就失效了（界面上照实说）。
        enableFileCheckpointing: true,
        settingSources: [],
        includePartialMessages: true,
        resume: resumeFrom || undefined,
        // 中转站地址和 token 从 Haven 那份配置里来（api 模式）。
        // ⚠️ 这是子进程的环境变量，spawn 时定死 —— 换中转站 / 换订阅只能新建对话。
        env: buildCcEnv(cred, envOverrides),
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
                  if (hit) {
                    const item = {
                      name: String(toolName || '工具'),
                      id: `deny-${Date.now()}`,
                      denied: hit,
                    }
                    pushToolEvent(sessionId, item)
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        permissionDecision: 'deny' as const,
                        permissionDecisionReason:
                          `这个路径含密钥/凭据，前端一律不给读（${hit}）。` +
                          '需要里面的值就直接问用户，别自己找别的路子读。',
                      },
                    }
                  }

                  // Grep 的口子（4.5b 遗留）：Grep 不点名文件，上面那条按路径拦的
                  // 规则一条都碰不到，`grep -r "sk-"` 就能把密钥值捞进上下文。
                  // 第一道：没写 glob 就替它加上排除清单。
                  //（写了 glob 的情况碰不了 —— 覆盖掉会改变它要找的范围。
                  //  那种情况靠下面 PostToolUse 把命中行擦掉。）
                  if (toolName === 'Grep') {
                    const gi = (toolInput || {}) as Record<string, unknown>
                    if (!gi.glob && !gi.type) {
                      return {
                        hookSpecificOutput: {
                          hookEventName: 'PreToolUse' as const,
                          updatedInput: { ...gi, glob: GREP_EXCLUDE_GLOB },
                        },
                      }
                    }
                  }

                  // 写和跑命令：强制走「问一次」。
                  //
                  // ⚠️ 光靠 permissionMode: 'default' + 不放进 allowedTools 是不够的 ——
                  // SDK 自己有一层「安全命令」判定，`echo hello` 这类它直接放行，
                  // canUseTool 根本不会被调用（实测：第一版就这么漏出去了）。
                  // 这里显式把决定改成 'ask'，才真的落到 canUseTool 上等浏览器点。
                  if (WRITE_TOOLS.includes(String(toolName)) || toolName === 'Bash') {
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        permissionDecision: 'ask' as const,
                        permissionDecisionReason: '这一步要用户在浏览器里点批准。',
                      },
                    }
                  }
                  return {}
                },
              ],
            },
          ],
          // 工具跑完：① 密钥行从输出里擦掉（Grep 那道的第二层）
          //          ② 记进工作台的「改了哪些文件 / 命令输出」
          PostToolUse: [
            {
              hooks: [
                async input => {
                  const {
                    tool_name: toolName,
                    tool_input: toolInput,
                    tool_response: toolResponse,
                    tool_use_id: toolUseId,
                  } = input as {
                    tool_name?: string
                    tool_input?: unknown
                    tool_response?: unknown
                    tool_use_id?: string
                  }
                  const ti = (toolInput || {}) as Record<string, unknown>
                  const name = String(toolName || '')

                  if (WRITE_TOOLS.includes(name)) {
                    const path = String(ti.file_path || ti.notebook_path || '')
                    // 行数只是给人看个量级，不追求跟 git diff 一致
                    const added =
                      name === 'Write'
                        ? countLines(String(ti.content || ''))
                        : countLines(String(ti.new_string || ''))
                    const removed =
                      name === 'Write' ? 0 : countLines(String(ti.old_string || ''))
                    if (path) recordFileChange(sessionId, { path, tool: name, added, removed })
                    return {}
                  }

                  if (name === 'Bash') {
                    const out = toolResponseText(toolResponse)
                    recordCommand(sessionId, {
                      id: String(toolUseId || `cmd-${Date.now()}`),
                      command: String(ti.command || ''),
                      output: out,
                      failed: /\berror\b|not recognized|command not found/i.test(out),
                    })
                    return {}
                  }

                  if (name === 'Grep') {
                    const out = toolResponseText(toolResponse)
                    if (!out) return {}
                    const { text, removed } = scrubDeniedLines(out)
                    if (!removed) return {}
                    pushToolEvent(sessionId, {
                      name: 'Grep',
                      id: `scrub-${Date.now()}`,
                      scrubbed: removed,
                    })
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PostToolUse' as const,
                        updatedToolOutput: text,
                      },
                    }
                  }
                  return {}
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
                  const info = {
                    ok: recall.ok,
                    error: recall.error || undefined,
                    card_count: recall.cardCount,
                    chars: recall.chars,
                    elapsed_ms: recall.elapsedMs,
                    domains: recall.domains,
                    recalled_ids: recall.recalledIds,
                    injected: recall.ok && recall.chars > 0,
                  }
                  // ⚠️ 写进「当轮」的桶、推给「当轮」的流。
                  // 以前这里是直接赋值给闭包变量 + 闭包里的 send，于是第 2 轮起
                  // 界面上召回信息不刷新、写库的 raw.recall 是空的。
                  const b = turnBuckets.get(sessionId)
                  if (b) b.recallInfo = info
                  // 前端顶部要显示「这一轮召回了几条 / 多少字」，作为「召回时好时坏」
                  // 的现场证据。注入正文暂不回传（下一轮做存库 + 点开查看）。
                  emit(sessionId, 'recall', info)
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

      const live = ensureSession({
        sessionId,
        buildOptions,
        // 这几项只在**新建**会话时记下 —— 已有会话沿用它启动时那套。
        // 界面上「本窗口设置」显示的是这份，不是前端最新的选择。
        boot: { mode, credKind: cred, providerId, providerLabel },
        model,
        effort,
        thinking,
      })

      if (live.busy) {
        send('error', { message: '这个会话上一轮还没跑完' })
        controller.close()
        return
      }
      live.busy = true
      live.lastModelCallAt = Date.now()
      stamp(live.turnCount > 0 ? '沿用已有子进程' : '子进程建好了')

      // 自己给这句话编个 id：回退（rewindFiles）要的就是「回到哪句话之前」，
      // 而它认的是消息 uuid。不自己编就没有可回退的锚点。
      const turnUuid = randomUUID()
      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        uuid: turnUuid,
      }

      /** 锁是不是已经在正常路径上摘过了（收尾前就摘，让人能马上发下一句） */
      let busyReleased = false

      try {
        live.push(userMessage)
        recordCheckpoint(sessionId, turnUuid, text)
        send('start', { session_id: sessionId, at: startedAt })
        stamp('这句话交给子进程了')

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
                if (!assistantText) stamp('模型吐出第一个字')
                assistantText += ev.delta.text
                send('delta', { text: ev.delta.text })
              } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
                if (!thinkingText) stamp('模型开始思考')
                thinkingText += ev.delta.thinking
                send('thinking', { text: ev.delta.thinking })
              }
            }
            continue
          }

          if (msg.type === 'assistant') {
            for (const block of msg.message.content) {
              if (block.type === 'tool_use') {
                bucket.toolEvents.push({
                  name: block.name,
                  id: block.id,
                  input: block.input,
                })
                send('tool', { name: block.name, id: block.id, input: block.input })
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
            recordTurnCost(sessionId, Number(msg.total_cost_usd || 0))
            turnUsage = usageFromResult(msg.usage, msg.duration_ms, msg.total_cost_usd)
            // 顶部上下文胶囊：就用这一轮的输入总量，不再去问子进程（见 noteContextUsage 的注释）
            noteContextUsage(
              sessionId,
              turnUsage.inputTokens + turnUsage.cacheReadTokens + turnUsage.cacheWriteTokens,
              live.model,
            )
            break
          }
        }

        stamp('模型说完了')

        // 这一轮对模型的占用到此为止（iterator 已经空了），提前把锁摘掉 ——
        // 不然收尾这一秒里用户又发一句，会被顶回「上一轮还没跑完」。
        // ⚠️ 摘锁到下面读 bucket / turnSnapshot 之间不许有 await，
        // 否则新的一轮会把 turnBuckets 换掉，这一轮就存错召回记录。
        live.busy = false
        busyReleased = true

        // ⚠️ 顺序是故意的：先把 done 发出去，再做写库和上下文用量。
        // 这两步都要走网络（Haven 在 Zeabur / 子进程一次控制请求），
        // 放在 done 前面会让浏览器一直停在「回复中」——第 5.2 步就是这么慢的。
        // 收尾做完再补一个 after 事件，只用来刷新顶部那几个数字。
        send('done', {
          result: resultInfo,
          usage: turnUsage,
          stats: getSessionStats(sessionId),
          elapsed_ms: Date.now() - startedAt,
        })

        // ── 写回 Haven 的 conversation_turns ────────────────────────────
        // sessionId 跟 hook 用的是同一个值（同一个变量），不会分组串。
        let storeInfo: Record<string, unknown>
        if (assistantText.trim()) {
          const rec = await withTimeout(recordTurn({
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
              // 5.2：这一轮是闲聊还是工作、走的哪个中转站、用量明细。
              // 历史消息读回来时右下角那个 token 面板靠 usage 重建。
              mode,
              provider_id: providerId || undefined,
              usage: turnUsage || undefined,
              persona_id: persona?.id || undefined,
              persona_name: persona?.name || undefined,
              thinking: thinkingText || undefined,
              recall: bucket.recallInfo,
              tools: bucket.toolEvents,
              result: resultInfo,
              // 第 5 步：改了哪些文件、跑了哪些命令、批了/拒了什么。
              // 子进程回收后工作台就靠这份重建（历史消息读回来也能看见）。
              work: turnSnapshot(sessionId),
            },
          }), STORE_TIMEOUT_MS, null)
          storeInfo = rec
            ? {
                ok: rec.ok,
                stored: rec.stored,
                turn_id: rec.turnId,
                round_id: rec.roundId,
                error: rec.error || undefined,
              }
            : { ok: false, stored: false, error: `写库超过 ${STORE_TIMEOUT_MS / 1000}s 没回，这一轮没存上` }
        } else {
          storeInfo = { ok: false, stored: false, error: '模型没有文本输出，不写库' }
        }
        stamp('写库完')

        // 上下文用量：这一轮答完了才拉（getContextUsage 要走一次控制请求，
        // 这一轮还占着 iterator 的时候拿不到）。顶部那个「x / 1M」胶囊用它。
        // ⚠️ 带 force —— busy 还没摘（要挡住下一个请求挤进来），但 iterator 已经空了。
        // 超时就用上一次的值：这只是个显示用的数字，不值得让人多等。
        // 不带 force —— 锁上面已经摘了，这时候 busy 还是 true 就说明用户又发了一句，
        // 那正在占着 iterator，这个数字下一轮再拿。
        send('after', {
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
        // 正常路径上面已经摘过了（为了让人能立刻发下一句）。
        // 这里兜出错的情况；已经摘过就别再动 —— 那可能是下一轮占的锁。
        if (!busyReleased) live.busy = false
        // 这一轮的口子摘掉，免得下一轮的 hook 往已经关掉的流里推
        detachSend(sessionId, send)
        // 只删自己那份：收尾这一秒里可能已经有新的一轮把它换掉了
        if (turnBuckets.get(sessionId) === bucket) turnBuckets.delete(sessionId)
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
  turnBuckets.delete(sessionId)
  writeDirsBySession.delete(sessionId)
  // 工作台那四格跟着清 —— 回退点已经随子进程失效了，留着只会骗人
  resetChannel(sessionId, '会话被手动收掉了，这个操作取消。')
  return Response.json({ ok: true })
}
