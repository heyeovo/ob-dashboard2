// runTurn（单轮 cc 对话执行器）的集成测试（9.5 步建）。
//
// 思路：mock 掉 @anthropic-ai/claude-agent-sdk 的 query（不真起子进程、不花钱），
// 用「脚本」控制它吐出来的 SDK 消息序列，跑**真实**的 runTurn —— 真实
// ccSession / ccChannel / processCollector 都在路径上，只有网络和子进程是假的。
//
// 覆盖架构 handoff（HANDOFF-cc架构优化.md）第 9.5 步列的关键集成测试：
//   1. 普通文本回复
//   2. thinking → tool → thinking → reply 的顺序还原
//   3. 一轮连续两个工具
//   4. 工具返回错误后模型仍继续
//   5. tool_result 后自动续写，不等待下一条用户消息
//   6. 浏览器中止后释放 busy（同一会话可立即再发）
//   7. provider 503 后能立即发起下一轮，错误轮次不写入 Haven
// 第 8 条（旧历史无 process 仍能正常展示）在 tests/cc-history.test.ts。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runTurn, type RunTurnInput } from '@/app/lib/cc/runTurn'
import { applyRuntimeSettings, dropSession, getProUsage } from '@/app/lib/ccSession'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import type { TurnConfig } from '@/app/lib/cc/ccOptions'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/* ── mock SDK：query 按全局脚本吐消息 ── */

const sdk = vi.hoisted(() => ({
  /** 当前脚本。query 被调用时按它造迭代器。 */
  script: [] as unknown[],
  queryCalls: 0,
  promptIterators: [] as AsyncIterator<SDKUserMessage>[],
  queryOptions: [] as Array<Record<string, unknown>>,
  usageResult: null as Record<string, unknown> | null,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    sdk.queryCalls += 1
    sdk.promptIterators.push(prompt[Symbol.asyncIterator]())
    sdk.queryOptions.push(options)
    const iter = makeIterator(sdk.script)
    return {
      [Symbol.asyncIterator]: () => iter,
      interrupt: async () => undefined,
      setModel: async () => undefined,
      applyFlagSettings: async () => undefined,
      setMaxThinkingTokens: async () => undefined,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => sdk.usageResult,
    }
  },
}))

/** 按脚本造异步迭代器。元素带 _hang 标记时永不 resolve（等 abort 触发）。 */
function makeIterator(script: unknown[]) {
  let i = 0
  return {
    next: () => {
      if (i >= script.length) return Promise.resolve({ done: true, value: undefined })
      const item = script[i++]
      if (item && (item as { _hang?: boolean })._hang) return new Promise(() => undefined)
      return Promise.resolve({ done: false, value: item })
    },
    return: () => Promise.resolve({ done: true, value: undefined }),
  }
}

/* ── mock Haven 网络 ── */

const turns = vi.hoisted(() => ({
  recordTurn: vi.fn(),
  getSession: vi.fn(),
  listAllTurns: vi.fn(),
  listTurns: vi.fn(),
  updatePersonaFromExchange: vi.fn(),
}))

vi.mock('@/app/lib/havenTurns', () => ({
  recordTurnStrict: turns.recordTurn,
  getConversationSession: turns.getSession,
  listAllTurns: turns.listAllTurns,
  listTurns: turns.listTurns,
  updatePersonaFromExchange: turns.updatePersonaFromExchange,
}))

const recall = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('@/app/lib/havenRecall', () => ({
  recallForPrompt: recall.run,
}))

/* ── 消息构造 ── */

function initMsg(sessionId = 'cc-test-1'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    claude_code_version: 'test',
    model: 'test-model',
    cwd: 'C:\\Users\\test',
    session_id: sessionId,
  } as SDKMessage
}

function textDelta(text: string): SDKMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  } as SDKMessage
}

function thinkingDelta(text: string): SDKMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: text } },
  } as SDKMessage
}

function toolUse(id: string, name: string, input: unknown = {}): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  } as SDKMessage
}

function toolResult(id: string, content: unknown, isError = false): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
    },
  } as SDKMessage
}

function resultMsg(
  subtype = 'success',
  isError = false,
  errors: string[] = [],
): SDKMessage {
  return {
    type: 'result',
    subtype,
    is_error: isError,
    errors,
    num_turns: 1,
    duration_ms: 100,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 30,
      cache_creation: {
        ephemeral_1h_input_tokens: 10,
        ephemeral_5m_input_tokens: 20,
      },
    },
  } as SDKMessage
}

/* ── runTurn 驱动 ── */

function makeConfig(overrides: Partial<TurnConfig> = {}): TurnConfig {
  return {
    sessionId: 'ob2-test-session',
    mode: 'chat',
    personaAppend: '',
    systemPromptKey: '',
    cwd: 'C:\\Users\\test\\repo',
    additionalDirectories: [],
    activeWebTools: [],
    sdkModel: 'test-model',
    effort: '',
    thinking: true,
    sdkMcpServers: {},
    disabledTools: [],
    webSettings: DEFAULT_WEB_SETTINGS,
    permanentAllowRules: [],
    cred: 'api',
    laneId: 'api:default',
    envOverrides: {},
    model: 'test-model',
    providerId: '',
    providerLabel: '',
    ...overrides,
  }
}

type RunHandle = {
  promise: ReturnType<typeof runTurn>
  events: Array<{ event: string; data: Record<string, unknown> }>
  ac: AbortController
  closed: boolean
}

function driveTurn(
  script: SDKMessage[],
  options: Partial<RunTurnInput> = {},
): RunHandle {
  const sessionId = options.sessionId || 'ob2-test-session'
  sdk.script = script
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const ac = new AbortController()
  const handle: RunHandle = {
    promise: Promise.resolve() as never,
    events,
    ac,
    closed: false,
  }
  handle.promise = runTurn({
    sessionId,
    requestId: options.requestId || 'request-test-1',
    expectedLastRoundId: options.expectedLastRoundId ?? 0,
    personaId: options.personaId || 'ombre',
    text: options.text || '你好',
    persona: options.persona ?? null,
    config: options.config || makeConfig({ sessionId }),
    handoff: options.handoff || { bucketIds: [], turns: 0, fromSession: '' },
    signal: ac.signal,
    // 跟真实 route 的 send 一样：调用时就序列化（模拟 SSE 编码时机）。
    // 不能存对象引用 —— 服务端后续会原地改 tool.status 等字段，
    // 已推给前端的事件不该跟着变。
    send: (event, data) =>
      events.push({ event, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> }),
    close: () => {
      handle.closed = true
    },
    stamp: () => undefined,
    resumeHint: options.resumeHint,
  })
  return handle
}

function eventNames(handle: RunHandle): string[] {
  return handle.events.map(e => e.event)
}

beforeEach(() => {
  sdk.script = []
  sdk.queryCalls = 0
  sdk.promptIterators = []
  sdk.queryOptions = []
  sdk.usageResult = {
    subscription_type: 'pro', rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 25, resets_at: '2026-08-22T08:00:00Z' },
      seven_day: { utilization: 40, resets_at: '2026-08-29T08:00:00Z' },
    },
  }
  recall.run.mockReset()
  recall.run.mockResolvedValue({
    ok: false,
    error: '',
    additionalContext: '',
    cardCount: 0,
    chars: 0,
    elapsedMs: 0,
    domains: [],
    recalledIds: [],
  })
  turns.recordTurn.mockReset()
  turns.recordTurn.mockResolvedValue({
    ok: true,
    stored: true,
    turnId: 1,
    roundId: 1,
    elapsedMs: 1,
    error: '',
    httpStatus: null,
    idempotentReplay: false,
    code: '',
    details: {},
  })
  turns.getSession.mockReset()
  turns.getSession.mockResolvedValue({
    ok: true,
    found: true,
    session: {
      profile_id: 'default',
      session_id: 'ob2-test-session',
      persona_id: 'ombre',
      title: '',
      local_engine_preference: 'cc',
      selfhost_overrides: {},
      cc_seen_round_id: 0,
      state_version: 0,
      deleted_at: null,
      updated_at: '',
    },
    bucketExclusionIds: [],
    error: '',
    httpStatus: 200,
  })
  turns.listAllTurns.mockReset()
  turns.listAllTurns.mockResolvedValue({ ok: true, turns: [], error: '' })
  turns.listTurns.mockReset()
  turns.listTurns.mockResolvedValue({ ok: true, turns: [], error: '' })
  turns.updatePersonaFromExchange.mockReset()
  turns.updatePersonaFromExchange.mockResolvedValue({ ok: true, updated: true, error: '' })
})

afterEach(() => {
  // ccSession 的 registry 挂在 globalThis，跨测试共享 —— 用完收掉
  dropSession('ob2-test-session')
})

describe('runTurn：普通回复', () => {
  it('文本回复严格走完一轮：start → delta → usage/保存 → done → after', async () => {
    const handle = driveTurn([initMsg(), textDelta('你好'), textDelta('呀'), resultMsg()])
    const result = await handle.promise

    expect(result.ok).toBe(true)
    expect(result.phase).toBe('succeeded')
    const names = eventNames(handle)
    expect(names).toEqual(expect.arrayContaining(['start', 'delta', 'delta', 'done', 'after']))
    expect(names.indexOf('usage')).toBeLessThan(names.indexOf('done'))
    expect(names.indexOf('done')).toBeLessThan(names.indexOf('after'))
    expect(handle.closed).toBe(true)

    // 写库被调一次，带正确分组键和正文
    expect(turns.recordTurn).toHaveBeenCalledTimes(1)
    const recInput = turns.recordTurn.mock.calls[0][0]
    expect(recInput.sessionId).toBe('ob2-test-session')
    expect(recInput.userText).toBe('你好')
    expect(recInput.assistantText).toBe('你好呀')
    expect(recInput.source).toBe('cc')
    expect(recInput.route).toBe('/api/cc-chat')
    expect(recInput.requestId).toBe('request-test-1')
    expect(recInput.expectedLastRoundId).toBe(0)
    expect(recInput.personaId).toBe('ombre')

    // done 带用量和统计
    const done = handle.events.find(e => e.event === 'done')!
    expect(done.data.usage).toMatchObject({ inputTokens: 10, outputTokens: 20 })
    expect(done.data.interrupted).toBeUndefined()
  })

  it('把当前 CC 线路游标后的其他线路原文一次性补入 SDK 消息，并记录补齐元数据', async () => {
    turns.getSession.mockResolvedValueOnce({
      ok: true,
      found: true,
      session: {
        profile_id: 'default', session_id: 'ob2-test-session', persona_id: 'ombre', title: '',
        local_engine_preference: 'cc', selfhost_overrides: {}, cc_seen_round_id: 1,
        cc_lanes: { 'api:default': { seen_round_id: 1 } },
        state_version: 0, deleted_at: null, updated_at: '',
      },
      bucketExclusionIds: ['already-recalled', 'created-here'],
      error: '',
      httpStatus: 200,
    })
    turns.listAllTurns.mockResolvedValueOnce({
      ok: true,
      turns: [
        {
          id: 2, session_id: 'ob2-test-session', round_id: 2, created_at: '',
          user_text: '出门后说的话', assistant_text: '自建引擎的回答', model: '', client: '',
          route: '/api/cc-chat-selfhost', source: 'selfhost',
          raw_json: JSON.stringify({
            recall: { additional_context: '自建引擎当时看到的桶 A' },
          }),
        },
      ],
      error: '',
    })
    const handle = driveTurn([initMsg(), textDelta('接上了'), resultMsg()])
    await handle.promise

    const pushed = await sdk.promptIterators[0].next()
    const content = String(pushed.value?.message.content || '')
    expect(content).toContain('<之前的记忆>')
    expect(content).toContain('自建引擎当时看到的桶 A')
    expect(content).toContain('<上次聊到这里>')
    expect(content).toContain('出门后说的话')
    expect(content).toContain('自建引擎的回答')
    expect(content.indexOf('<之前的记忆>')).toBeLessThan(content.indexOf('<上次聊到这里>'))
    expect(content.lastIndexOf('你好')).toBeGreaterThan(content.indexOf('</上次聊到这里>'))
    expect(turns.listAllTurns).toHaveBeenCalledWith('ob2-test-session', expect.objectContaining({
      afterRoundId: 1,
      includeRaw: true,
    }))
    expect(recall.run).toHaveBeenCalledWith('你好', expect.objectContaining({
      excludeIds: ['already-recalled', 'created-here'],
    }))
    const recInput = turns.recordTurn.mock.calls[0][0]
    expect(recInput.userText).toBe('你好')
    expect(recInput.raw.continuity).toEqual({
      lane_id: 'api:default',
      injected_turns: 1,
      after_round_id: 1,
      through_round_id: 2,
      round_ids: [2],
    })
    expect(handle.events.find(event => event.event === 'done')?.data.continuity_turns).toBe(1)
  })

  it('当前 CC 线路游标已经推进后不再重复补入同一批轮次', async () => {
    turns.getSession.mockResolvedValueOnce({
      ok: true,
      found: true,
      session: {
        profile_id: 'default', session_id: 'ob2-test-session', persona_id: 'ombre', title: '',
        local_engine_preference: 'cc', selfhost_overrides: {}, cc_seen_round_id: 3,
        cc_lanes: { 'api:default': { seen_round_id: 3 } },
        state_version: 1, deleted_at: null, updated_at: '',
      },
      bucketExclusionIds: [], error: '', httpStatus: 200,
    })
    const handle = driveTurn([initMsg(), textDelta('没有重复'), resultMsg()])
    await handle.promise

    const pushed = await sdk.promptIterators[0].next()
    expect(String(pushed.value?.message.content || '')).not.toContain('<上次聊到这里>')
    expect(turns.listAllTurns).toHaveBeenCalledWith('ob2-test-session', expect.objectContaining({
      afterRoundId: 3,
    }))
    expect(turns.recordTurn.mock.calls[0][0].raw.continuity).toBeUndefined()
  })

  it('Pro 与 API 使用独立 Claude session，切回 API 只 resume 自己的接回点', async () => {
    const apiConfig = makeConfig({
      cred: 'api', laneId: 'api:provider-a', providerId: 'provider-a',
      envOverrides: { baseUrl: 'https://api.example.test', authToken: 'api-secret' },
    })
    await driveTurn([initMsg('api-native-session'), textDelta('API 一'), resultMsg()], {
      config: apiConfig,
    }).promise

    const proConfig = makeConfig({
      cred: 'subscription', laneId: 'subscription', providerId: '', envOverrides: {},
    })
    await driveTurn([initMsg('pro-native-session'), textDelta('Pro 一'), resultMsg()], {
      requestId: 'request-pro-1', expectedLastRoundId: 1, config: proConfig,
    }).promise

    await driveTurn([initMsg('api-native-session-2'), textDelta('API 二'), resultMsg()], {
      requestId: 'request-api-2', expectedLastRoundId: 2, config: apiConfig,
    }).promise

    expect(sdk.queryCalls).toBe(3)
    expect(sdk.queryOptions[0].resume).toBeUndefined()
    expect(sdk.queryOptions[1].resume).toBeUndefined()
    expect(sdk.queryOptions[2].resume).toBe('api-native-session')
    expect((sdk.queryOptions[1].env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect((sdk.queryOptions[2].env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('api-secret')
  })

  it('中途开启 thinking 会重建 query、resume 原生 session 并显式使用 adaptive', async () => {
    const offConfig = makeConfig({
      cred: 'subscription', laneId: 'subscription', providerId: '', envOverrides: {},
      model: 'claude-opus-4-6', sdkModel: 'claude-opus-4-6', thinking: false,
    })
    await driveTurn([initMsg('thinking-native-session'), textDelta('先直接答'), resultMsg()], {
      config: offConfig,
    }).promise
    expect(sdk.queryOptions[0].thinking).toEqual({ type: 'disabled' })

    expect(await applyRuntimeSettings('ob2-test-session', { thinking: true })).toEqual({
      ok: true, error: '',
    })
    const onConfig = { ...offConfig, thinking: true }
    await driveTurn([initMsg('thinking-native-session-2'), thinkingDelta('思考摘要'), textDelta('再回答'), resultMsg()], {
      requestId: 'request-thinking-on', expectedLastRoundId: 1, config: onConfig,
    }).promise

    expect(sdk.queryCalls).toBe(2)
    expect(sdk.queryOptions[1].resume).toBe('thinking-native-session')
    expect(sdk.queryOptions[1].thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(turns.recordTurn.mock.calls[1][0].raw.thinking).toBe('思考摘要')
  })

  it('CC 线路只补最终文字，不同步 thinking 或附件内容', async () => {
    turns.getSession.mockResolvedValueOnce({
      ok: true, found: true,
      session: {
        profile_id: 'default', session_id: 'ob2-test-session', persona_id: 'ombre', title: '',
        local_engine_preference: 'cc', selfhost_overrides: {}, cc_seen_round_id: 1,
        cc_lanes: { 'api:default': { seen_round_id: 1 } },
        state_version: 0, deleted_at: null, updated_at: '',
      },
      bucketExclusionIds: [], error: '', httpStatus: 200,
    })
    turns.listAllTurns.mockResolvedValueOnce({
      ok: true,
      turns: [{
        id: 2, session_id: 'ob2-test-session', round_id: 2, created_at: '',
        user_text: '请看那张图', assistant_text: '图里是一只猫', model: '', client: '',
        route: '/api/cc-chat', source: 'cc',
        raw_json: JSON.stringify({
          cred_mode: 'subscription', thinking: '不能跨线路同步的推理',
          attachments: [{ filename: 'secret-image.png', extracted_text: '附件正文' }],
        }),
      }],
      error: '',
    })

    const handle = driveTurn([initMsg(), textDelta('接住了'), resultMsg()])
    await handle.promise
    const pushed = await sdk.promptIterators[0].next()
    const content = String(pushed.value?.message.content || '')
    expect(content).toContain('请看那张图')
    expect(content).toContain('图里是一只猫')
    expect(content).not.toContain('不能跨线路同步的推理')
    expect(content).not.toContain('secret-image.png')
    expect(content).not.toContain('附件正文')
  })

  it('在线 Pro session 可读取五小时和周额度，API session 不冒充订阅额度', async () => {
    const proConfig = makeConfig({
      cred: 'subscription', laneId: 'subscription', providerId: '', envOverrides: {},
    })
    await driveTurn([initMsg('pro-usage-session'), textDelta('Pro'), resultMsg()], {
      config: proConfig,
    }).promise
    const usage = await getProUsage('ob2-test-session')
    expect(usage).toMatchObject({
      available: true,
      stale: false,
      subscriptionType: 'pro',
      fiveHour: { utilization: 25 },
      sevenDay: { utilization: 40 },
    })

    await driveTurn([initMsg('api-after-pro'), textDelta('API'), resultMsg()], {
      requestId: 'request-api-after-pro', expectedLastRoundId: 1,
      config: makeConfig({ cred: 'api', laneId: 'api:default' }),
    }).promise
    const stale = await getProUsage('ob2-test-session')
    expect(stale.available).toBe(true)
    expect(stale.stale).toBe(true)
  })

  it('把现有 hold 新建结果里的桶 ID 写进本窗口排除账本', async () => {
    const handle = driveTurn([
      initMsg(),
      toolUse('hold-1', 'mcp__ombre__hold', { content: '记住这件事' }),
      toolResult('hold-1', '新建→一件重要的事 life [bucket_id=abc123def456]'),
      textDelta('记住了'),
      resultMsg(),
    ])
    await handle.promise

    expect(turns.recordTurn.mock.calls[0][0].createdBucketIds).toEqual(['abc123def456'])
    expect(turns.recordTurn.mock.calls[0][0].raw.created_bucket_ids).toEqual(['abc123def456'])
  })

  it('从 hold 结构化成功结果提取新桶，但合并结果不计作新建', async () => {
    const handle = driveTurn([
      initMsg(),
      toolUse('hold-created', 'mcp__ombre__hold', { content: '新记忆' }),
      toolResult('hold-created', JSON.stringify({
        status: 'success', action: 'created', bucket_id: 'abc123def456', bucket_name: '新记忆',
      })),
      toolUse('hold-merged', 'mcp__ombre__hold', { content: '旧记忆' }),
      toolResult('hold-merged', JSON.stringify({
        status: 'success', action: 'merged', bucket_id: 'fff111aaa222', bucket_name: '旧记忆',
      })),
      textDelta('处理完成'),
      resultMsg(),
    ])
    await handle.promise

    expect(turns.recordTurn.mock.calls[0][0].createdBucketIds).toEqual(['abc123def456'])
  })

  it('连续 text delta 拼成一段正文，process 也合并成一段', async () => {
    const handle = driveTurn([
      initMsg(),
      textDelta('让我先查一下'),
      textDelta('，稍等'),
      textDelta('查到了：答案是 42'),
      resultMsg(),
    ])
    await handle.promise
    const recInput = turns.recordTurn.mock.calls[0][0]
    // 原逻辑：同一 text 段内连续拼接（appendTextProcess 合并成一段），
    // 空行分隔只在「前一段不是 text」（如 thinking 之后重新开口）时出现。
    expect(recInput.assistantText).toBe('让我先查一下，稍等查到了：答案是 42')
    const process = recInput.raw.process
    expect(process.map((p: { type: string }) => p.type)).toEqual(['text'])
    expect(process[0].text).toBe('让我先查一下，稍等查到了：答案是 42')
  })
})

describe('runTurn：工具循环', () => {
  it('thinking → tool → thinking → reply 按真实顺序还原', async () => {
    const handle = driveTurn([
      initMsg(),
      thinkingDelta('用户问了什么'),
      toolUse('t1', 'Read', { file_path: 'a.ts' }),
      toolResult('t1', '文件内容'),
      thinkingDelta('文件看完了'),
      textDelta('这是回答'),
      resultMsg(),
    ])
    const result = await handle.promise

    expect(result.phase).toBe('succeeded')
    const names = eventNames(handle)
    expect(names).toEqual(expect.arrayContaining(['thinking', 'tool', 'tool_result', 'thinking', 'delta']))

    // 写库的 process 完整保留顺序
    const recInput = turns.recordTurn.mock.calls[0][0]
    const process = recInput.raw.process
    expect(process.map((p: { type: string }) => p.type)).toEqual([
      'thinking',
      'tool',
      'thinking',
      'text',
    ])
    // 第一个 thinking 在工具开始时要被收尾（有 durationMs）
    expect(process[0]).toMatchObject({ type: 'thinking', text: '用户问了什么' })
    expect(typeof process[0].durationMs).toBe('number')
    // 工具状态补成 completed + 耗时
    expect(recInput.raw.tools[0]).toMatchObject({ id: 't1', name: 'Read', status: 'completed' })
    expect(typeof recInput.raw.tools[0].durationMs).toBe('number')
    // tool 事件与 tool_result 事件都推给了前端
    const toolEvent = handle.events.find(e => e.event === 'tool')!
    expect(toolEvent.data).toMatchObject({ id: 't1', status: 'running' })
    const toolResultEvent = handle.events.find(e => e.event === 'tool_result')!
    expect(toolResultEvent.data).toMatchObject({ id: 't1', status: 'completed' })
  })

  it('一轮连续两个工具，都收进 toolEvents 并按顺序展示', async () => {
    const handle = driveTurn([
      initMsg(),
      toolUse('t1', 'Grep', { pattern: 'foo' }),
      toolUse('t2', 'Read', { file_path: 'b.ts' }),
      toolResult('t1', 'grep 结果'),
      toolResult('t2', '文件内容'),
      textDelta('两个工具都用完了'),
      resultMsg(),
    ])
    const result = await handle.promise
    expect(result.phase).toBe('succeeded')

    const recInput = turns.recordTurn.mock.calls[0][0]
    expect(recInput.raw.tools.map((t: { id: string }) => t.id)).toEqual(['t1', 't2'])
    expect(recInput.raw.tools.every((t: { status: string }) => t.status === 'completed')).toBe(true)
    const processTypes = recInput.raw.process.map((p: { type: string }) => p.type)
    expect(processTypes).toEqual(['tool', 'tool', 'text'])
  })

  it('工具返回错误后模型仍能继续，错误内容记在工具上', async () => {
    const handle = driveTurn([
      initMsg(),
      toolUse('t1', 'Read', { file_path: 'c.ts' }),
      toolResult('t1', '文件不存在', true),
      textDelta('文件不存在，我换一种方式'),
      resultMsg(),
    ])
    const result = await handle.promise
    expect(result.phase).toBe('succeeded')

    const recInput = turns.recordTurn.mock.calls[0][0]
    expect(recInput.raw.tools[0]).toMatchObject({ id: 't1', status: 'error', error: '文件不存在' })
    const toolResultEvent = handle.events.find(e => e.event === 'tool_result')!
    expect(toolResultEvent.data).toMatchObject({ id: 't1', status: 'error', error: '文件不存在' })
  })

  it('tool_result 后模型自动续写，不等待下一条用户消息', async () => {
    // 脚本里 tool_result 之后紧跟 thinking + 正文 + result ——
    // runTurn 消费流时收到 tool_result 只是整理事件，不会停、不会等。
    const handle = driveTurn([
      initMsg(),
      toolUse('t1', 'Bash', { command: 'echo hi' }),
      toolResult('t1', 'hi'),
      thinkingDelta('继续想'),
      textDelta('续写的内容'),
      resultMsg(),
    ])
    const result = await handle.promise
    expect(result.phase).toBe('succeeded')
    expect(eventNames(handle)).toEqual(
      expect.arrayContaining(['tool_result', 'thinking', 'delta', 'done']),
    )
    // 一轮只写一次库 —— 续写不会拆成第二轮
    expect(turns.recordTurn).toHaveBeenCalledTimes(1)
  })
})

describe('runTurn：中止与失败', () => {
  it('浏览器中止：cancelled、不写库、busy 释放后可立即再发', async () => {
    const handle = driveTurn([
      initMsg(),
      textDelta('半截'),
      { _hang: true } as unknown as SDKMessage,
    ])

    // 等主循环进入挂起状态，然后断开浏览器
    await new Promise(resolve => setTimeout(resolve, 20))
    handle.ac.abort()

    const result = await handle.promise
    expect(result.ok).toBe(false)
    expect(result.phase).toBe('cancelled')
    // 中止的轮次不写 Haven
    expect(turns.recordTurn).not.toHaveBeenCalled()
    // SSE 流也关了（前端会显示「连接已断开」而不是一直转圈）
    expect(handle.closed).toBe(true)

    // busy 已释放：同一个会话立刻再来一轮，能正常答完
    const again = driveTurn([initMsg(), textDelta('第二轮'), resultMsg()])
    const result2 = await again.promise
    expect(result2.ok).toBe(true)
    expect(result2.phase).toBe('succeeded')
  })

  it('provider 503：failed、错误轮不写库、子进程被回收后可立即重试', async () => {
    const handle = driveTurn([initMsg(), resultMsg('error', true)])
    const result = await handle.promise

    expect(result.ok).toBe(false)
    expect(result.phase).toBe('failed')
    expect(eventNames(handle)).toContain('error')
    // 错误轮次不写入 Haven
    expect(turns.recordTurn).not.toHaveBeenCalled()

    // dropSession 已把坏子进程收掉，同一会话立刻重试能成功
    const again = driveTurn([initMsg(), textDelta('重试成功'), resultMsg()])
    const result2 = await again.promise
    expect(result2.ok).toBe(true)
    expect(result2.phase).toBe('succeeded')
    expect(turns.recordTurn).toHaveBeenCalledTimes(1)
  })

  it('Pro 中途命中额度：保存用户消息、半截回复和额度中断标记', async () => {
    const handle = driveTurn([
      initMsg(),
      textDelta('已经生成的半截'),
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' },
      } as SDKMessage,
      resultMsg('error_during_execution', true, ['Usage limit reached']),
    ], { config: makeConfig({ cred: 'subscription' }) })
    const result = await handle.promise

    expect(result).toMatchObject({ ok: true, phase: 'succeeded' })
    expect(turns.recordTurn).toHaveBeenCalledTimes(1)
    expect(turns.recordTurn.mock.calls[0][0]).toMatchObject({
      userText: '你好',
      assistantText: '已经生成的半截',
      raw: { interrupted: true, interrupted_reason: 'pro_limit' },
    })
    expect(handle.events.find(event => event.event === 'done')?.data).toMatchObject({
      interrupted: true,
      interrupted_reason: 'pro_limit',
    })
  })

  it('Pro 在输出前命中额度：仍保存用户消息和空回复状态', async () => {
    const handle = driveTurn([
      initMsg(),
      resultMsg('error_during_execution', true, ["You've reached your usage limit"]),
    ], { config: makeConfig({ cred: 'subscription' }) })
    const result = await handle.promise

    expect(result).toMatchObject({ ok: true, phase: 'succeeded' })
    expect(turns.recordTurn).toHaveBeenCalledTimes(1)
    expect(turns.recordTurn.mock.calls[0][0]).toMatchObject({
      userText: '你好',
      assistantText: '',
      raw: { interrupted: true, interrupted_reason: 'pro_limit' },
    })
  })

  it('生成后发生 409：只发结构化 error，不发 done，并收掉私有 cc 进程', async () => {
    turns.recordTurn.mockResolvedValueOnce({
      ok: false,
      stored: false,
      turnId: 0,
      roundId: 0,
      elapsedMs: 1,
      error: '另一端产生了新消息，请刷新后重试',
      httpStatus: 409,
      idempotentReplay: false,
      code: 'conversation_conflict',
      details: { expected_last_round_id: 0, actual_last_round_id: 1 },
    })
    const handle = driveTurn([initMsg(), textDelta('已生成正文'), resultMsg()])
    const result = await handle.promise

    expect(result.phase).toBe('failed')
    expect(eventNames(handle)).not.toContain('done')
    const error = handle.events.find(event => event.event === 'error')?.data
    expect(error).toMatchObject({
      code: 'conversation_conflict',
      http_status: 409,
      generated_not_saved: true,
      actual_last_round_id: 1,
    })
  })
})
