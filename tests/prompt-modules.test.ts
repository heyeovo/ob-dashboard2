import { describe, expect, it } from 'vitest'
import {
  buildPersonaAppend,
  type HavenPersona,
} from '@/app/lib/havenPersonas'
import {
  DEFAULT_PERSONA_BASE_PROMPT,
  LEGACY_SELFHOST_BASE_PROMPT,
} from '@/app/lib/personaPrompt'

function persona(overrides: Partial<HavenPersona> = {}): HavenPersona {
  return {
    id: 'yan-zhi',
    name: '言之',
    initial: '言',
    tint: '',
    user_name: '小羊',
    purpose: '长期协作者',
    description: '',
    prompt: '',
    prompt_modules: [],
    memory_entries: [],
    dirs: [],
    write_dirs: [],
    recall_on: true,
    semantic_on: true,
    engine: 'selfhost',
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('提示词模块 system 组装', () => {
  it('不把界面名称机械注入 system', () => {
    const result = buildPersonaAppend(persona())
    expect(result).not.toContain('你在这个对话里的名字是「言之」。')
    expect(result).not.toContain('称呼对方为「小羊」。')
  })

  it('三个渠道共用旧 cc 闲聊提示词作为唯一默认基础提示词', () => {
    const result = buildPersonaAppend(persona())
    expect(result.startsWith(DEFAULT_PERSONA_BASE_PROMPT)).toBe(true)
    expect(result.split(DEFAULT_PERSONA_BASE_PROMPT)).toHaveLength(2)
  })

  it('使用协作者默认状态，并允许当前窗口逐项覆盖', () => {
    const input = persona({
      prompt_modules: [
        { id: 'interaction', name: '互动规则', content: '自然回应。', enabled_by_default: true },
        { id: 'sleep', name: '睡前 checklist', content: '检查睡前事项。', enabled_by_default: false },
      ],
    })

    const defaults = buildPersonaAppend(input)
    expect(defaults).toContain('自然回应。')
    expect(defaults).toContain('【互动规则】\n自然回应。')
    expect(defaults).not.toContain('检查睡前事项。')

    const overridden = buildPersonaAppend(input, { interaction: false, sleep: true })
    expect(overridden).not.toContain('自然回应。')
    expect(overridden).toContain('检查睡前事项。')
  })

  it('把旧整块提示词无损视为一个默认开启模块', () => {
    const result = buildPersonaAppend(persona({
      prompt: '这是旧提示词原文。',
      prompt_modules: [],
    }))
    expect(result).toContain('这是旧提示词原文。')
  })

  it('使用协作者自己的基础提示词，并允许明确留空', () => {
    const custom = buildPersonaAppend(persona({ base_prompt: '这是自定义基础提示词。' }))
    expect(custom.startsWith('这是自定义基础提示词。')).toBe(true)
    expect(custom).not.toContain('你正在 Ombre Brain 的自建聊天链路中回复用户。')

    const empty = buildPersonaAppend(persona({ base_prompt: '' }))
    expect(empty).not.toContain(DEFAULT_PERSONA_BASE_PROMPT)
  })

  it('把刚加入过的旧 selfhost 默认文案迁成统一默认值', () => {
    const result = buildPersonaAppend(persona({ base_prompt: LEGACY_SELFHOST_BASE_PROMPT }))
    expect(result.startsWith(DEFAULT_PERSONA_BASE_PROMPT)).toBe(true)
    expect(result).not.toContain(LEGACY_SELFHOST_BASE_PROMPT)
  })
})
