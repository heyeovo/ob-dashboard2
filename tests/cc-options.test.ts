import { describe, expect, it } from 'vitest'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import {
  buildCcOptions,
  sdkModelForProvider,
  thinkingConfigForModel,
  type TurnConfig,
} from '@/app/lib/cc/ccOptions'
import {
  AGENT_WAKE_SERVER_NAME,
  beginAgentWakeTurn,
  endAgentWakeTurn,
} from '@/app/lib/cc/agentWakeTool'

function config(mode: TurnConfig['mode']): TurnConfig {
  return {
    sessionId: 'prompt-test',
    mode,
    personaAppend: '统一的协作者基础提示词',
    systemPromptKey: 'prompt-key',
    cwd: 'C:\\workspace',
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
  }
}

describe('cc 基础提示词渠道一致性', () => {
  it('订阅固定模型不改写，API 中转仍使用 1M 映射', () => {
    expect(sdkModelForProvider('claude-opus-4-6', 'subscription')).toBe('claude-opus-4-6')
    expect(sdkModelForProvider('provider-opus-4-6', 'api')).toBe('opus[1m]')
  })

  it('为 4.6+ 显式开启 adaptive thinking，并兼容旧模型', () => {
    expect(thinkingConfigForModel('claude-opus-4-6', true)).toEqual({
      type: 'adaptive', display: 'summarized',
    })
    expect(thinkingConfigForModel('opus[1m]', true)).toEqual({
      type: 'adaptive', display: 'summarized',
    })
    expect(thinkingConfigForModel('claude-opus-4-5-20251101', true)).toEqual({
      type: 'enabled', budgetTokens: 10_000, display: 'summarized',
    })
    expect(thinkingConfigForModel('unknown-provider-model', true)).toBeUndefined()
    expect(thinkingConfigForModel('claude-opus-4-6', false)).toEqual({ type: 'disabled' })
  })

  it('把显式 thinking 配置交给 Agent SDK', () => {
    const adaptive = config('chat')
    adaptive.sdkModel = 'claude-opus-4-6'
    expect(buildCcOptions(adaptive, null).thinking).toEqual({
      type: 'adaptive', display: 'summarized',
    })
    adaptive.thinking = false
    expect(buildCcOptions(adaptive, null).thinking).toEqual({ type: 'disabled' })
  })

  it('闲聊模式只注入一次协作者配置', () => {
    expect(buildCcOptions(config('chat'), null).systemPrompt).toBe('统一的协作者基础提示词')
  })

  it('工作模式把同一份配置追加到 Claude Code 预设', () => {
    expect(buildCcOptions(config('work'), null).systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: '统一的协作者基础提示词',
    })
  })

  it('固定注入进程内 wake 工具，不随普通 MCP 清单变化', () => {
    const options = buildCcOptions(config('chat'), null)
    expect(options.mcpServers).toHaveProperty(AGENT_WAKE_SERVER_NAME)
  })

  it('后台拒绝 Bash 和写入，不进入浏览器批准流程', async () => {
    beginAgentWakeTurn('prompt-test', 'background')
    try {
      const options = buildCcOptions(config('work'), null)
      const preTool = options.hooks?.PreToolUse?.[0]?.hooks?.[0]
      expect(preTool).toBeTypeOf('function')
      const decision = await preTool!(
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pwd' } } as never,
        undefined,
        { signal: new AbortController().signal },
      )
      expect(decision).toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' },
      })
    } finally {
      endAgentWakeTurn('prompt-test')
    }
  })
})
