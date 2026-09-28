import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../app/lib/appearance'

describe('appearance theme normalization', () => {
  it('keeps the four supported themes', () => {
    for (const theme of ['apricot', 'sakura', 'mist', 'dusk']) {
      expect(normalizeAppearance({ theme }).theme).toBe(theme)
    }
  })

  it('moves saved linen and unknown themes to apricot', () => {
    expect(DEFAULT_APPEARANCE.theme).toBe('apricot')
    expect(normalizeAppearance({ theme: 'linen' }).theme).toBe('apricot')
    expect(normalizeAppearance({ theme: 'unknown' }).theme).toBe('apricot')
  })
})
