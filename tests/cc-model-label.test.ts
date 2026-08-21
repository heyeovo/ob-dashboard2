import { describe, expect, it } from 'vitest'
import { modelLabel, providerModelForSdkModel } from '@/app/cc/upstream'

describe('cc model labels', () => {
  it('maps the SDK 1M suffix back to the configured provider model', () => {
    const configured = '[kiro量高缓]claude-opus-4-6'
    expect(providerModelForSdkModel(`${configured}[1m]`, [configured])).toBe(configured)
    expect(modelLabel(`${configured}[1m]`, [configured])).toBe(configured)
  })

  it('resolves the bare SDK alias from an Opus 4.6 candidate', () => {
    const configured = '[kiro量高缓]claude-opus-4-6'
    expect(providerModelForSdkModel('opus[1m]', [configured])).toBe(configured)
  })

  it('does not present a moving SDK alias as fixed Opus 4.6', () => {
    expect(providerModelForSdkModel('opus[1m]')).toBe('opus[1m]')
    expect(modelLabel('opus[1m]')).toBe('opus（1M 动态别名）')
  })

  it('never maps a subscription model through the API provider alias', () => {
    const configured = 'claude-opus-4-6'
    expect(providerModelForSdkModel('opus[1m]', [configured], 'subscription')).toBe('opus[1m]')
    expect(modelLabel('opus[1m]', [configured], 'subscription')).toBe('opus（1M 动态别名）')
  })
})
