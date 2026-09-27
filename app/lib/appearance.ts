export type Appearance = {
  version: 1
  theme: 'linen'
  background: { kind: 'gradient' | 'upload' | 'none'; assetId?: string }
  glass: { blur: number; opacity: number }
  font: { display: 'serif' | 'sans'; scale: number }
  effects: { rain: { mode: 'off' | 'on' | 'weather'; intensity: number } }
}

export const DEFAULT_APPEARANCE: Appearance = {
  version: 1,
  theme: 'linen',
  background: { kind: 'gradient' },
  glass: { blur: 12, opacity: 0.78 },
  font: { display: 'serif', scale: 1 },
  effects: { rain: { mode: 'off', intensity: 0.35 } },
}

export const APPEARANCE_CACHE_KEY = 'ob2-appearance-v1'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function number(value: unknown, fallback: number, min: number, max: number, precision: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Number(Math.max(min, Math.min(max, parsed)).toFixed(precision))
    : fallback
}

export function normalizeAppearance(value: unknown): Appearance {
  const input = record(value)
  const background = record(input.background)
  const glass = record(input.glass)
  const font = record(input.font)
  const rain = record(record(input.effects).rain)
  const kind = background.kind === 'upload' && typeof background.assetId === 'string' && background.assetId
    ? 'upload'
    : background.kind === 'none' ? 'none' : 'gradient'
  return {
    version: 1,
    theme: 'linen',
    background: typeof background.assetId === 'string' && background.assetId
      ? { kind, assetId: background.assetId }
      : { kind },
    glass: {
      blur: number(glass.blur, 12, 0, 30, 1),
      opacity: number(glass.opacity, 0.78, 0.4, 1, 2),
    },
    font: {
      display: font.display === 'sans' ? 'sans' : 'serif',
      scale: number(font.scale, 1, 0.85, 1.3, 2),
    },
    effects: {
      rain: {
        mode: rain.mode === 'on' || rain.mode === 'weather' ? rain.mode : 'off',
        intensity: number(rain.intensity, 0.35, 0, 1, 2),
      },
    },
  }
}

export function appearanceHtmlStyle(appearance: Appearance): Record<string, string> {
  const background = appearance.background
  return {
    '--glass-blur': `${appearance.glass.blur}px`,
    '--glass-opacity': String(appearance.glass.opacity),
    '--font-scale': String(appearance.font.scale),
    '--effect-rain-intensity': String(appearance.effects.rain.intensity),
    '--bg-image': background.kind === 'upload'
      ? `url("/api/appearance/background?assetId=${encodeURIComponent(background.assetId || '')}")`
      : background.kind === 'none' ? 'none' : 'var(--bg-gradient)',
    '--bg-overlay': background.kind === 'upload' ? 'var(--bg-photo-overlay)' : 'none',
  }
}
