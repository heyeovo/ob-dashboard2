import { describe, expect, it } from 'vitest'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import { buildCcOptions, type TurnConfig } from '@/app/lib/cc/ccOptions'

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
})
