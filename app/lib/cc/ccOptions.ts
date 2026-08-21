// claude code SDK 的 Options 组装（9.5 从 route.ts 的 POST 闭包原样抽出）。
//
// 为什么单独一层：buildOptions 只在会话**第一轮**跑一次（ccSession 里已有会话
// 就复用），所以它和它里面的 hooks / canUseTool 都只能通过 sessionId 去查
// 「当前这一轮」的状态，不能捕获当轮局部变量 —— 4.5b 那个「召回信息第二轮
// 不刷新」就是这么来的。这里把「这一轮真正生效的配置」打成一份不可变快照
// （TurnConfig）传进来，组装函数就是纯的，可以单独测。
//
// ⚠️ 唯一保持模块级的状态是 writeDirsBySession：canUseTool 每轮都要读它，
// 而它跟「协作者配的写目录」绑定、跨轮存活（配置改完立刻生效），不适合
// 打进每一轮的快照里。

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import {
  EXEC_TOOLS,
  GREP_EXCLUDE_GLOB,
  READ_PATH_TOOLS,
  WRITE_TOOLS,
  isDeniedPath,
  isReadablePath,
  isWritablePath,
  pathTargetFromToolInput,
  pathsFromToolInput,
  scrubDeniedLines,
} from '@/app/lib/ccDirs'
import { buildCcEnv, type CredMode } from '@/app/lib/ccEnv'
import {
  isMcpTool,
  mcpPermissionForTool,
  toSdkMcpServers,
} from '@/app/lib/ccMcp'
import type { CcMode } from '@/app/lib/ccModes'
import { autoAllowEdits, recordCommand, recordFileChange, requestPermission } from '@/app/lib/ccChannel'
import { diffForEdit, diffForWrite, diffPlaceholder } from '@/app/lib/ccDiff'
import { getTurnBucket, pushToolEvent } from '@/app/lib/cc/processCollector'
import type { CcWebSettings } from '@/app/cc/webSettings'
import type { CcPermKind } from '@/app/lib/ccChannel'

/** 直接放行、不弹批准卡的只读工具。 */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

/**
 * 模型手上有哪些工具。
 *
 * 只列界面能说明和展示的工具；WebSearch / WebFetch 在两种模式都开放，
 * 其余工作工具只在工作模式开放。
 */
const WORK_TOOLS = [...READ_ONLY_TOOLS, ...WRITE_TOOLS, 'Bash']

/**
 * API 中转站要求收到自己的模型 ID，但 Claude Code 需要认识模型身份才能采用正确上下文。
 * `opus[1m]` 会在子进程内按 Opus 1M 管理上下文，再由 ANTHROPIC_DEFAULT_OPUS_MODEL
 * 映射回中转原始 ID。订阅线路必须原样传完整模型 ID；`opus[1m]` 是会随
 * Claude Code 升级改变目标的动态别名，不能用来固定 Opus 4.6。
 */
export function sdkModelForProvider(providerModel: string, cred: CredMode): string {
  const model = providerModel.trim()
  if (cred === 'api' && /(?:^|[-_.])opus[-_.]?4[-_.]?6(?:$|[-_.])/i.test(model)) return 'opus[1m]'
  return model
}

const LEGACY_THINKING_BUDGET = 10_000

/**
 * 新模型必须显式开 adaptive；旧 Claude thinking 模型继续使用固定预算。
 * 认不出的中转模型保持 SDK 默认，避免给不兼容的非 Claude 模型硬塞参数。
 */
export function thinkingConfigForModel(
  model: string,
  enabled: boolean,
): Options['thinking'] | undefined {
  if (!enabled) return { type: 'disabled' }
  const value = model.trim().toLowerCase()
  const movingAlias = /^(?:opus|sonnet|fable|mythos)(?:\[1m\])?$/.test(value)
  const adaptiveClaude = /(?:^|[-_.])(?:opus|sonnet)[-_.]?(?:4[-_.]?(?:6|[7-9])|[5-9])(?:$|[-_.])/.test(value)
  if (movingAlias || adaptiveClaude) return { type: 'adaptive', display: 'summarized' }
  const legacyClaude = /(?:^|[-_.])(?:opus|sonnet|haiku)[-_.]?(?:3|4[-_.]?[0-5])(?:$|[-_.])/.test(value)
  if (legacyClaude) {
    return { type: 'enabled', budgetTokens: LEGACY_THINKING_BUDGET, display: 'summarized' }
  }
  return undefined
}

/* ── 这一轮真正生效的配置快照 ── */

export type TurnConfig = {
  sessionId: string
  mode: CcMode
  personaAppend: string
  /** 只标识协作者身份与提示词模块；不包含仅在新窗口首轮装载的 handoff。 */
  systemPromptKey: string
  cwd: string
  additionalDirectories: string[]
  /** 闲聊模式只给本窗口开启的联网工具；工作模式另有 7 个内置工具 */
  activeWebTools: string[]
  sdkModel: string
  effort: string
  thinking: boolean
  sdkMcpServers: ReturnType<typeof toSdkMcpServers>
  /** 关闭的工具从模型上下文移除（名字 + 说明 + 参数结构都不给） */
  disabledTools: string[]
  webSettings: CcWebSettings
  permanentAllowRules: string[]
  cred: CredMode
  /** 同一 Dashboard 窗口内隔离 Claude 原生 session 的线路键。 */
  laneId: string
  envOverrides: { baseUrl?: string; authToken?: string }
  model: string
  /** 启动时定死的中转站（api 时有值），会话状态里照实显示用 */
  providerId: string
  providerLabel: string
}

export function ccLaneId(cred: CredMode, providerId: string): string {
  return cred === 'subscription' ? 'subscription' : `api:${providerId.trim() || 'default'}`
}

/** 这个会话能写哪些目录。同样每轮重读 —— 改完配置开新对话生效，跟提示词一致。 */
const writeDirsBySession = new Map<string, string[]>()

export function setWriteDirs(sessionId: string, dirs: string[]) {
  writeDirsBySession.set(sessionId, dirs)
}

export function getWriteDirs(sessionId: string): string[] {
  return writeDirsBySession.get(sessionId) || []
}

export function clearWriteDirs(sessionId: string) {
  writeDirsBySession.delete(sessionId)
}

/* ── 工具分类 ── */

function toolKind(toolName: string): CcPermKind {
  if (toolName === 'Edit' || toolName === 'NotebookEdit') return 'edit'
  if (toolName === 'Write') return 'write'
  if (EXEC_TOOLS.includes(toolName)) return 'bash'
  if (toolName === 'WebFetch') return 'web'
  return 'other'
}

function isWebTool(toolName: string): boolean {
  return toolName === 'WebSearch' || toolName === 'WebFetch'
}

/** 主循环判断工具结果要不要存（Web 工具走这里的截断口径）。 */
export { isWebTool, storedMcpResult, storedWebResult }

function domainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const rule = domain.toLowerCase().replace(/\.$/, '')
  return host === rule || host.endsWith(`.${rule}`)
}

function fetchDomainAllowed(rawUrl: unknown, settings: CcWebSettings): boolean {
  if (settings.domainMode === 'all') return true
  let hostname = ''
  try {
    hostname = new URL(String(rawUrl || '')).hostname
  } catch {
    return false
  }
  const matched = settings.domains.some(domain => domainMatches(hostname, domain))
  return settings.domainMode === 'allow' ? matched : !matched
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

/** MCP 返回值留给日常回看；限制体积，避免一个网页/搜索结果把整轮 raw_json 撑爆。 */
function storedMcpResult(res: unknown, limit = 20_000): string {
  let text = toolResponseText(res)
  if (!text && res != null) {
    try {
      text = JSON.stringify(res, null, 2)
    } catch {
      text = String(res)
    }
  }
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n… 余下 ${text.length - limit} 字未保存`
}

function limitSearchSources(value: unknown, maxSources: number): unknown {
  let remaining = maxSources
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const sourceArray =
        node.length > 0 &&
        node.every(item => item && typeof item === 'object' && 'url' in item)
      const items = sourceArray ? node.slice(0, Math.max(0, remaining)) : node
      if (sourceArray) remaining = Math.max(0, remaining - items.length)
      return items.map(visit)
    }
    if (!node || typeof node !== 'object') return node
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, item]) => [key, visit(item)]),
    )
  }
  return visit(value)
}

function storedWebResult(res: unknown, toolName: string, settings: CcWebSettings): string {
  let safe = res
  if (toolName === 'WebSearch') {
    if (typeof res === 'string') {
      try {
        safe = limitSearchSources(JSON.parse(res), settings.maxDisplayedSources)
      } catch {
        safe = res
      }
    } else {
      safe = limitSearchSources(res, settings.maxDisplayedSources)
    }
  }
  const limit =
    toolName === 'WebFetch' ? Math.max(2_000, settings.fetchTargetTokens * 4) : 20_000
  return storedMcpResult(safe, limit)
}

/** 数一下 Edit / Write 实际动了多少行，工作台「改了哪些文件」那格要显示。 */
function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

/* ── Options 组装 ── */

/**
 * 组装这一轮（新建会话时）的 SDK Options。
 *
 * @param config 这一轮真正生效的配置快照（route 从 body + Haven 配置解析出来的）。
 * @param resumeFrom 上一轮记下的 claude code session id；没有就是 null。
 */
export function buildCcOptions(config: TurnConfig, resumeFrom: string | null): Options {
  const {
    sessionId,
    mode,
    personaAppend,
    cwd,
    additionalDirectories,
    activeWebTools,
    sdkModel,
    effort,
    thinking,
    sdkMcpServers,
    disabledTools,
    webSettings,
    permanentAllowRules,
    cred,
    envOverrides,
    model,
  } = config

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
    if (isMcpTool(toolName)) {
      const policy = mcpPermissionForTool(toolName)
      if (policy === 'allow') return { behavior: 'allow' }
      if (policy === 'deny') {
        return { behavior: 'deny', message: '这个 MCP 服务当前设为禁止使用。' }
      }
    }

    const kind = toolKind(toolName)
    const dirs = writeDirsBySession.get(sessionId) || []
    const filePath = String(
      (input as Record<string, unknown>).file_path ||
        (input as Record<string, unknown>).notebook_path ||
        '',
    )

    // 写清单之外的一律硬拒，不弹卡片 —— 这不是「要不要批准」的问题，
    // 是根本没配。空清单时这里会拒掉所有写操作，界面上会提示去哪加。
    if (WRITE_TOOLS.includes(toolName) && !(await isWritablePath(filePath, dirs, cwd))) {
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
      suggestions: meta.suggestions || [],
    })
    return decision.behavior === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: decision.message }
  }

  return {
    model: sdkModel || undefined,
    effort: (effort || undefined) as Options['effort'],
    thinking: thinkingConfigForModel(sdkModel, thinking),
    // 工作模式：协作者人设接在 claude code 自带系统提示**后面**，不替换它 ——
    //   那段里有工具怎么用、路径怎么写，换掉工具就废了。
    // 闲聊模式：只使用协作者统一配置；不再额外注入一份写死的闲聊提示词。
    // 同一份 personaAppend 也会用于工作模式和 selfhost，前端只需维护一次。
    systemPrompt:
      mode === 'chat'
        ? personaAppend
        : personaAppend
          ? { type: 'preset', preset: 'claude_code', append: personaAppend }
          : { type: 'preset', preset: 'claude_code' },
    cwd,
    additionalDirectories,
    // 闲聊模式只给本窗口开启的联网工具；工作模式再加读写、搜索文件与 Bash。
    tools: mode === 'chat' ? activeWebTools : [...WORK_TOOLS, ...activeWebTools],
    // MCP 跟 Claude Code 内置工具是两条独立通道。strict 保证实际工具集
    // 跟 Home 管理页完全一致，
    // 不暗中混入 ~/.claude 或项目 .mcp.json 的其它服务。
    mcpServers: sdkMcpServers,
    strictMcpConfig: true,
    // 关闭的工具连名称/说明/参数结构都从模型上下文移除；开启的 MCP 服务
    // 在 ccMcp.ts 里设为 alwaysLoad，所以工具定义固定放在消息历史之前。
    disallowedTools: disabledTools,
    // 本地只读和 WebSearch 自动放行。WebFetch 按域名问；Bash 走 SDK 标准规则，
    // 用户可在卡片上选仅一次 / 本次对话 / 始终允许。
    allowedTools:
      mode === 'chat'
        ? webSettings.searchEnabled
          ? ['WebSearch']
          : []
        : [
            ...READ_ONLY_TOOLS,
            ...(webSettings.searchEnabled ? ['WebSearch'] : []),
          ],
    // 'default' 而不是第 4 步那个 'dontAsk' —— dontAsk 会把没预批的直接拒掉，
    // 根本走不到 canUseTool，也就没有批准这回事了。
    permissionMode: 'default',
    canUseTool: askPermission,
    settings: {
      permissions: {
        allow: permanentAllowRules,
      },
    },
    // 回退点要它：把改动前的文件备份下来，rewindFiles 才有东西可还原。
    // ⚠️ 备份活在子进程里，进程被回收后这些点就失效了（界面上照实说）。
    enableFileCheckpointing: true,
    settingSources: [],
    includePartialMessages: true,
    resume: resumeFrom || undefined,
    // 中转站地址和 token 从 Haven 那份配置里来（api 模式）。
    // ⚠️ 这是子进程的环境变量，spawn 时定死。线路切换由 ccSession 回收当前
    // query，再按独立 resumeKey 恢复目标线路，不能跨凭据复用原生 session。
    env: buildCcEnv(cred, { ...envOverrides, mainModel: model }),
    hooks: buildCcHooks(config),
  }
}

/* ── hooks ── */

/**
 * 组装 PreToolUse / PostToolUse 两个 hook。
 *
 * ⚠️ hook 闭包也是第一轮建的，所以里面只能用 sessionId / 快照里的值，
 * 当轮变量一律经 processCollector 的桶拿。
 *
 * UserPromptSubmit 这里**故意没有** —— 召回已经搬到发送前做了（见 runTurn）：
 * hook 返回的 additionalContext 会被 SDK 包成 messages 里的 role:"system"
 * 消息，中转站不认这种 role，静默丢掉 —— 模型压根收不到记忆卡。
 */
function buildCcHooks(config: TurnConfig): Options['hooks'] {
  const { sessionId, webSettings, cwd, additionalDirectories } = config
  const readDirs = [cwd, ...additionalDirectories]

  return {
    // ↓ 缓存排查用（见 OB基础知识/HANDOFF-cc缓存排查-第2版.md）。
    //
    // 症状：缓存读钉死在静态段，缓存写随历史一路涨 —— 消息段每轮重写、从不读回。
    // 开着 debug 是为了让子进程把这类 warn 吐到 stderr，下面 stderr 回调只筛不改：
    //   [mid-conv-system] server rejected role:"system"    → 退回不带 system 轮的请求体
    //   [mid-conv-system] proxy rejected cache_control ... → 断点降级到尾部消息
    // 两条都是 sticky（直到 /clear 或 /compact）。2026-07-27 实测四轮零触发，
    // 所以中转站没在拒断点 —— 这条已排除，日志留着是为了下次能一眼看见，不是待查项。
    // ⚠️ 只观察，不改任何断点逻辑。嫌终端吵就把这行和下面的 stderr 回调一起删。
    PreToolUse: [
      {
        hooks: [
          async input => {
            const { tool_name: toolName, tool_input: toolInput } =
              input as { tool_name?: string; tool_input?: unknown }
            const name = String(toolName || '')

            // MCP 权限以 Home 管理页为准。显式在 hook 层定 allow/ask/deny，
            // 避免 SDK 把某些“看起来安全”的工具直接放行、绕过 canUseTool。
            if (isMcpTool(name)) {
              const policy = mcpPermissionForTool(name)
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: policy,
                  permissionDecisionReason:
                    policy === 'allow'
                      ? '这个 MCP 服务已设为自动允许。'
                      : policy === 'deny'
                        ? '这个 MCP 服务已被禁用。'
                        : '这个 MCP 服务设为每次询问。',
                },
              }
            }

            if (name === 'WebSearch' || name === 'WebFetch') {
              const current = getTurnBucket(sessionId)
              const webInput = (toolInput || {}) as Record<string, unknown>

              if (name === 'WebSearch') {
                if (!webSettings.searchEnabled) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason: '这个窗口已关闭 Web Search。',
                    },
                  }
                }
                if (current && current.webSearchCount >= webSettings.maxSearchesPerTurn) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason:
                        `这一轮最多搜索 ${webSettings.maxSearchesPerTurn} 次，已经用完。`,
                    },
                  }
                }
                if (webSettings.domainMode === 'allow' && webSettings.domains.length === 0) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'deny' as const,
                      permissionDecisionReason: '本窗口选择了域名白名单，但还没有填写允许域名。',
                    },
                  }
                }
                if (current) current.webSearchCount += 1
                const domainPatch =
                  webSettings.domainMode === 'allow' && webSettings.domains.length > 0
                    ? { allowed_domains: webSettings.domains }
                    : webSettings.domainMode === 'block' && webSettings.domains.length > 0
                      ? { blocked_domains: webSettings.domains }
                      : {}
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    updatedInput: { ...webInput, ...domainPatch },
                  },
                }
              }

              if (!webSettings.fetchEnabled) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason: '这个窗口已关闭 Web Fetch。',
                  },
                }
              }
              if (!fetchDomainAllowed(webInput.url, webSettings)) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason:
                      webSettings.domainMode === 'allow'
                        ? '这个域名不在本窗口的允许清单中。'
                        : '这个域名在本窗口的禁止清单中。',
                  },
                }
              }
              if (current && current.webFetchCount >= webSettings.maxFetchesPerTurn) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason:
                      `这一轮最多抓取 ${webSettings.maxFetchesPerTurn} 个网页，已经用完。`,
                  },
                }
              }
              if (current) current.webFetchCount += 1
              const lengthInstruction =
                `只提取与用户当前问题直接相关的内容；` +
                `返回内容以约 ${webSettings.fetchTargetTokens} tokens 为目标上限。` +
                '这是长度目标，请优先保留事实、数字、结论和必要出处，省略导航、广告和重复内容。'
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  updatedInput: {
                    ...webInput,
                    prompt: [String(webInput.prompt || '').trim(), lengthInstruction]
                      .filter(Boolean)
                      .join('\n\n'),
                  },
                },
              }
            }

            const pathTarget = pathTargetFromToolInput(name, toolInput, cwd)
            if (READ_PATH_TOOLS.includes(name)) {
              if (!pathTarget || !(await isReadablePath(pathTarget, readDirs, cwd))) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason:
                      `这个读取路径不在允许的 workspace 内（${pathTarget || '未提供路径'}）。` +
                      `能读的是：${readDirs.join('、')}。`,
                  },
                }
              }
            }
            if (WRITE_TOOLS.includes(name)) {
              const writeDirs = writeDirsBySession.get(sessionId) || []
              if (!pathTarget || !(await isWritablePath(pathTarget, writeDirs, cwd))) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason: writeDirs.length
                      ? `这个写入路径不在允许的 workspace 内（${pathTarget || '未提供路径'}）。` +
                        `能写的是：${writeDirs.join('、')}。`
                      : '这个协作者还没配「能写哪些目录」，所以现在一个文件都不能改。',
                  },
                }
              }
            }

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

            // 写文件 + Bash：强制走「问一次」。
            //
            // ⚠️ 光靠 permissionMode: 'default' + 不放进 allowedTools 是不够的 ——
            // SDK 会直接放行某些看起来安全的写操作和”无害”命令（echo/ls）。
            // 在 hook 层显式 'ask'，所有写操作和命令都会走到 canUseTool 弹卡片，
            // SDK 的细粒度”本次对话 / 始终允许”规则才能真正生效。
            if (WRITE_TOOLS.includes(String(toolName)) || EXEC_TOOLS.includes(String(toolName))) {
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
  }
}
