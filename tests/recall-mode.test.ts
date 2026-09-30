import { describe, expect, it } from 'vitest'
import { resolveRecallEnabled } from '@/app/lib/recallMode'

describe('window recall precedence', () => {
  it('uses explicit request before the window setting and mode', () => {
    expect(resolveRecallEnabled(false, 'on', 'chat')).toBe(false)
    expect(resolveRecallEnabled(true, 'off', 'work')).toBe(true)
  })

  it('uses window setting before CHAT / WORK defaults', () => {
    expect(resolveRecallEnabled(undefined, 'off', 'chat')).toBe(false)
    expect(resolveRecallEnabled(undefined, 'on', 'work')).toBe(true)
    expect(resolveRecallEnabled(undefined, '', 'chat')).toBe(true)
    expect(resolveRecallEnabled(undefined, '', 'work')).toBe(false)
  })
})
