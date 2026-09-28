import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, appearanceHtmlStyle, normalizeAppearance, photoAccentActive } from '../app/lib/appearance'
import { pickAccent } from '../app/lib/photoAccent'

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

  it('defaults, clamps and emits independent type scales', () => {
    expect(normalizeAppearance({ font: { display: 'sans', scale: 1.1 } }).font).toEqual({
      display: 'sans', scale: 1.1, titleScale: 1, bodyScale: 1, metaScale: 1,
    })
    const appearance = normalizeAppearance({ font: { titleScale: 1.8, bodyScale: 0.5, metaScale: 1.3 } })
    expect(appearance.font).toEqual({ display: 'serif', scale: 1, titleScale: 1.4, bodyScale: 0.85, metaScale: 1.3 })
    expect(appearanceHtmlStyle(appearance)).toMatchObject({
      '--font-scale': '1', '--type-title-scale': '1.4', '--type-body-scale': '0.85', '--type-meta-scale': '1.3',
    })
  })

  it('clamps background intensity and keeps it across kinds', () => {
    expect(DEFAULT_APPEARANCE.background.intensity).toBe(0.7)
    expect(normalizeAppearance({}).background).toEqual({ kind: 'gradient', intensity: 0.7, accentMode: 'theme' })
    expect(normalizeAppearance({ background: { kind: 'none', intensity: 0.05 } }).background).toEqual({ kind: 'none', intensity: 0.2, accentMode: 'theme' })
    expect(normalizeAppearance({ background: { kind: 'upload', assetId: 'a1', intensity: 2 } }).background).toEqual({ kind: 'upload', assetId: 'a1', intensity: 1, accentMode: 'theme' })
  })

  it('only applies a photo accent on uploaded backgrounds that have one', () => {
    const photo = normalizeAppearance({ background: { kind: 'upload', assetId: 'a1', accentMode: 'photo', accent: { h: 400, s: 90 } } })
    expect(photo.background.accent).toEqual({ h: 40, s: 50 })
    expect(photoAccentActive(photo)).toBe(true)
    expect(photoAccentActive(normalizeAppearance({ background: { kind: 'upload', assetId: 'a1', accentMode: 'photo' } }))).toBe(false)
    expect(photoAccentActive(normalizeAppearance({ background: { kind: 'gradient', accentMode: 'photo', accent: { h: 10, s: 30 } } }))).toBe(false)
  })
})

function fill(pixels: number, rgb: [number, number, number], extra?: { count: number; rgb: [number, number, number] }) {
  const data = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    const c = extra && i < extra.count ? extra.rgb : rgb
    data.set([...c, 255], i * 4)
  }
  return data
}

describe('photo accent extraction', () => {
  it('picks the dominant coloured hue and ignores greys', () => {
    // 大面积灰白 + 三分之一海蓝：应取到蓝色，饱和度压进 25–50
    const accent = pickAccent(fill(48 * 48, [235, 235, 235], { count: 800, rgb: [60, 120, 190] }))
    expect(accent).not.toBeNull()
    expect(accent!.h).toBeGreaterThan(200)
    expect(accent!.h).toBeLessThan(220)
    expect(accent!.s).toBeLessThanOrEqual(50)
    expect(accent!.s).toBeGreaterThanOrEqual(25)
  })

  it('returns null for an almost colourless photo', () => {
    expect(pickAccent(fill(48 * 48, [128, 128, 128]))).toBeNull()
  })
})
