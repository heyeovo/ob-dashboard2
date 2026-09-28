export type Appearance = {
  version: 1
  theme: 'apricot' | 'sakura' | 'mist' | 'dusk'
  background: {
    kind: 'gradient' | 'upload' | 'none'
    assetId?: string
    intensity: number
    // 照片模式下强调色跟随主题还是跟随图片；accent 是从照片取出的色相 / 饱和度
    accentMode: 'theme' | 'photo'
    accent?: { h: number; s: number }
  }
  glass: { blur: number; opacity: number }
  font: { display: 'serif' | 'sans'; scale: number }
  effects: { rain: { mode: 'off' | 'on' | 'weather'; intensity: number } }
}

export const DEFAULT_APPEARANCE: Appearance = {
  version: 1,
  theme: 'apricot',
  background: { kind: 'gradient', intensity: 0.7, accentMode: 'theme' },
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

function normalizePhotoAccent(value: unknown): { accent?: { h: number; s: number } } {
  const accent = record(value)
  const h = Number(accent.h)
  const s = Number(accent.s)
  if (!Number.isFinite(h) || !Number.isFinite(s)) return {}
  return { accent: { h: Math.round(((h % 360) + 360) % 360), s: Math.round(Math.max(25, Math.min(50, s))) } }
}

export function photoAccentActive(appearance: Appearance): boolean {
  const background = appearance.background
  return background.kind === 'upload' && background.accentMode === 'photo' && Boolean(background.accent)
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
    theme: input.theme === 'sakura' || input.theme === 'mist' || input.theme === 'dusk'
      ? input.theme : 'apricot',
    background: {
      kind,
      ...(typeof background.assetId === 'string' && background.assetId ? { assetId: background.assetId } : {}),
      intensity: number(background.intensity, 0.7, 0.2, 1, 2),
      accentMode: background.accentMode === 'photo' ? 'photo' : 'theme',
      ...normalizePhotoAccent(background.accent),
    },
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
    '--rain-base-opacity': String(Number((appearance.effects.rain.intensity * 0.7).toFixed(3))),
    '--rain-extra-opacity': String(Number(Math.min(0.9, Math.max(0, (appearance.effects.rain.intensity - 0.3) * 1.3)).toFixed(3))),
    '--bg-image': background.kind === 'upload'
      ? `url("/api/appearance/background?assetId=${encodeURIComponent(background.assetId || '')}")`
      : background.kind === 'none' ? 'none' : 'var(--bg-gradient)',
    '--bg-intensity': String(background.intensity),
    '--photo-h': String(background.accent?.h ?? 0),
    '--photo-s': `${background.accent?.s ?? 0}%`,
    // 黄绿色相同亮度下更亮，压暗一点保证强调色上的白字对比度
    '--photo-l-shift': background.accent && background.accent.h >= 35 && background.accent.h <= 170 ? '-6%' : '0%',
    '--bg-overlay': background.kind === 'upload' ? 'var(--bg-photo-overlay)'
      : background.kind === 'gradient' ? 'var(--bg-gradient-veil)' : 'none',
  }
}
