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

  it('keeps the SDK alias until candidates load, but never shows it as a label', () => {
    expect(providerModelForSdkModel('opus[1m]')).toBe('opus[1m]')
    expect(modelLabel('opus[1m]')).toBe('claude-opus-4-6')
  })
})
