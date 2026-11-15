import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CcWindowSettings from '@/app/cc/CcWindowSettings'
import { EMPTY_STATS, type GptConnectionResponse } from '@/app/cc/types'
import { EMPTY_UPSTREAM, pickFromConfig, type CcUpstreamConfig } from '@/app/cc/upstream'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import { gptConnectionLabel, gptConnectionReady } from '@/app/cc/gptConnectionUi'

vi.mock('@/app/components/BodyPortal', () => ({ default: ({ children }: { children: ReactNode }) => children }))
type Props = ComponentProps<typeof CcWindowSettings>
const connected: GptConnectionResponse = { ok: true, configured: true, status: 'connected', sharing: true,
  login_method: 'local_ssh_import', limits: null, usage_url: 'https://chatgpt.com/settings/usage', connection_id: 'c1', account: 'x***' }
function props(overrides: Partial<Props> = {}): Props {
  const noop = vi.fn()
  const upstream: CcUpstreamConfig = { ...EMPTY_UPSTREAM, subscriptionModels: ['claude-from-config'], defaultKind: 'subscription', defaultModel: 'claude-from-config' }
  return { sessionId: 's', personaId: 'p', stats: EMPTY_STATS, totalChars: 0, conversationText: '', systemPromptText: '',
    activeProvider: '', activeModel: '', contextTokens: 0, contextMaxTokens: 0, upstream, pick: pickFromConfig(upstream),
    proUsage: null, onRefreshProUsage: noop, onPick: noop, web: DEFAULT_WEB_SETTINGS, onWebChange: noop,
    onSaveWebDefaults: noop, webSaving: false, engine: 'gpt_subscription', onEngineChange: noop, engineDisabled: false,
    isRemote: false, gptModel: 'real-model', gptModelSaving: false, onGptModelSave: noop,
    gptAccount: { connection: connected, models: { ok: true, models: [{ slug: 'real-model', displayName: 'Account Model' }] },
      loading: false, ready: true, reload: vi.fn(async () => {}) },
    mode: 'chat', onModeChange: noop, modeLocked: false, providerLocked: false, webLocked: false, note: '',
    onCompact: vi.fn(async () => ({ ok: false, compacted: false, error: '' })), onHandoff: noop, onClose: noop, ...overrides }
}
const render = (value: Props) => renderToStaticMarkup(createElement(CcWindowSettings, value))

describe('GPT reuses the existing window settings controls', () => {
  it('adds GPT to the engine choices and uses the single existing model dropdown', () => {
    const html = render(props())
    expect(html).toContain('>cc</button>')
    expect(html).toContain('>自建</button>')
    expect(html).toContain('>GPT</button>')
    expect(html.match(/<select/g)).toHaveLength(1)
    expect(html).toContain('aria-label="模型"')
    expect(html).toContain('value="real-model"')
    expect(html).toContain('Account Model')
    expect(html).not.toMatch(/claude-from-config|保存本窗口模型|已有授权|使用所选授权|断开当前授权|查看授权与重新连接步骤|Pro 额度/)
  })
  it.each(['cc', 'selfhost'] as const)('keeps %s settings free of the GPT status panel', engine => {
    const html = render(props({ engine }))
    expect(html).not.toContain('已保存授权')
    expect(html).not.toContain('额度未知')
    expect(html).not.toContain('Account Model')
    expect(html).not.toContain('断开当前授权')
    expect(html).toContain('claude-from-config')
  })
  it('keeps connection status unknown until it has been read', () => {
    const value = props(); value.gptAccount = { ...value.gptAccount, connection: null, models: null, ready: false }
    const html = render(value)
    expect(html).toContain('尚未读取授权状态')
    expect(html).toContain('额度未知')
    expect(html).toMatch(/<select[^>]*disabled=""/)
  })
  it('prioritizes a storage error over a connected label', () => {
    const state: GptConnectionResponse = { ...connected, error: { code: 'storage_failed', message: 'storage unavailable', action: 'inspect', retryable: false } }
    expect(gptConnectionLabel(state, false)).toBe('连接需要检查')
    expect(gptConnectionReady(state)).toBe(false)
    const value = props(); value.gptAccount = { ...value.gptAccount, connection: state, ready: false }
    const html = render(value)
    expect(html).toContain('不要用重新登录覆盖存储故障')
    expect(html).not.toContain('已保存授权')
  })
  it.each([
    [{ ...connected, configured: false }, '服务器尚未配置'],
    [{ ...connected, status: 'reauth_required' }, '需要重新授权'],
    [{ ...connected, status: 'disconnected' }, '尚未连接'],
    [{ ...connected, sharing: false }, '订阅共享未开启'],
  ] as const)('distinguishes unavailable authorization', (state, label) => {
    expect(gptConnectionLabel(state, false)).toBe(label)
    expect(gptConnectionReady(state)).toBe(false)
  })
  it('gives a short computer-login instruction when disconnected', () => {
    const value = props(); value.gptAccount = { ...value.gptAccount, connection: { ...connected, status: 'disconnected' }, ready: false }
    const html = render(value)
    expect(html).toContain('电脑专用管理工具登录')
    expect(html).toContain('SSH 安全交接')
    expect(html).toContain('手机不能直接完成授权')
    expect(html).not.toMatch(/<input|Bearer|access_token|refresh_token/)
  })
  it('retains an unavailable saved choice without silently substituting a model', () => {
    const html = render(props({ gptModel: 'previous-model' }))
    expect(html).toContain('previous-model（当前列表不可用）')
    expect(html).toContain('value="previous-model" disabled="" selected=""')
    expect(html).not.toContain('保存本窗口模型')
  })
  it('keeps the acknowledged choice on save failure and locks the dropdown while saving', () => {
    const failed = render(props({ note: '模型保存失败，请重试' }))
    expect(failed).toContain('value="real-model" selected=""')
    expect(failed).toContain('模型保存失败，请重试')
    const saving = render(props({ gptModelSaving: true, note: '正在保存 GPT 模型…' }))
    expect(saving).toMatch(/<select[^>]*disabled=""/)
    expect(saving).toContain('正在保存 GPT 模型')
  })
})
