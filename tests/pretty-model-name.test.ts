import { describe, expect, it } from 'vitest'
import { prettyModelName } from '../app/cc/upstream'

describe('prettyModelName', () => {
  it('shortens supported Claude model names without hiding unknown models', () => {
    expect(prettyModelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(prettyModelName('claude-sonnet-5')).toBe('Sonnet 5')
    expect(prettyModelName('claude-haiku-4-5-20261001')).toBe('Haiku 4.5')
    expect(prettyModelName('custom-model')).toBe('custom-model')
  })
})
