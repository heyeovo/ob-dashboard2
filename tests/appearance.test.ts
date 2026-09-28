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

  it('clamps background intensity and keeps it across kinds', () => {
    expect(DEFAULT_APPEARANCE.background.intensity).toBe(0.7)
    expect(normalizeAppearance({}).background).toEqual({ kind: 'gradient', intensity: 0.7 })
    expect(normalizeAppearance({ background: { kind: 'none', intensity: 0.05 } }).background).toEqual({ kind: 'none', intensity: 0.2 })
    expect(normalizeAppearance({ background: { kind: 'upload', assetId: 'a1', intensity: 2 } }).background).toEqual({ kind: 'upload', assetId: 'a1', intensity: 1 })
  })
})
