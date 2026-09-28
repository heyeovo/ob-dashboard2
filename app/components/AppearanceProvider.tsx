'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  APPEARANCE_CACHE_KEY,
  DEFAULT_APPEARANCE,
  appearanceHtmlStyle,
  normalizeAppearance,
  photoAccentActive,
  type Appearance,
} from '@/app/lib/appearance'
import { extractPhotoAccent, type PhotoAccent } from '@/app/lib/photoAccent'

type SaveStatus = 'saved' | 'saving' | 'error'
type AppearanceContextValue = {
  appearance: Appearance
  status: SaveStatus
  update: (change: (current: Appearance) => Appearance) => void
  uploadBackground: (file: File) => Promise<void>
  deleteBackground: () => Promise<void>
  setAccentMode: (mode: 'theme' | 'photo') => Promise<void>
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

function applyToDocument(value: Appearance) {
  const html = document.documentElement
  html.dataset.theme = value.theme
  html.dataset.font = value.font.display
  html.dataset.rain = value.effects.rain.mode
  html.dataset.background = value.background.kind
  html.dataset.accent = photoAccentActive(value) ? 'photo' : 'theme'
  for (const [key, entry] of Object.entries(appearanceHtmlStyle(value))) {
    html.style.setProperty(key, entry)
  }
}

export function AppearanceProvider({
  children,
  initial,
  initialFromHaven,
}: {
  children: ReactNode
  initial: Appearance
  initialFromHaven: boolean
}) {
  const [appearance, setAppearance] = useState(initial)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [cachedOnMount] = useState(() => {
    try {
      return typeof window === 'undefined' ? null : localStorage.getItem(APPEARANCE_CACHE_KEY)
    } catch {
      return null
    }
  })
  const dirty = useRef(false)
  const revision = useRef(0)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    applyToDocument(appearance)
    try {
      localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance))
    } catch {
      // 浏览器禁用存储时，当前页面仍可预览。
    }
  }, [appearance])

  useEffect(() => {
    if (initialFromHaven) return
    try {
      if (cachedOnMount) setAppearance(normalizeAppearance(JSON.parse(cachedOnMount)))
    } catch {
      // 缓存损坏时仍用服务端默认值。
    }
    let cancelled = false
    void fetch('/api/appearance', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Haven unavailable')
        return response.json() as Promise<{ appearance: unknown }>
      })
      .then(data => {
        if (!cancelled && !dirty.current) setAppearance(normalizeAppearance(data.appearance))
      })
      .catch(() => {
        if (!cancelled && !dirty.current) setAppearance(DEFAULT_APPEARANCE)
      })
    return () => { cancelled = true }
  }, [cachedOnMount, initialFromHaven])

  useEffect(() => {
    if (!dirty.current) return
    setStatus('saving')
    const currentRevision = revision.current
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
        const response = await fetch('/api/appearance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appearance),
        })
        if (!response.ok) throw new Error('save failed')
        const body = await response.json() as { appearance?: unknown }
        if (revision.current === currentRevision) {
          dirty.current = false
          setAppearance(normalizeAppearance(body.appearance))
          setStatus('saved')
        }
      }).catch(() => {
        if (revision.current === currentRevision) setStatus('error')
      })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [appearance])

  const update = useCallback((change: (current: Appearance) => Appearance) => {
    dirty.current = true
    revision.current += 1
    setAppearance(current => normalizeAppearance(change(current)))
  }, [])

  const uploadBackground = useCallback(async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/appearance/background', { method: 'POST', body: form })
    const payload = await response.json() as { assetId?: string; error?: string }
    if (!response.ok || !payload.assetId) throw new Error(payload.error || '背景图上传失败')
    // 取色失败不影响换背景，只是强调色继续跟随主题
    const accent: PhotoAccent | null = await extractPhotoAccent(file).catch(() => null)
    update(current => ({
      ...current,
      background: {
        ...current.background,
        kind: 'upload',
        assetId: payload.assetId,
        accentMode: accent ? 'photo' : 'theme',
        accent: accent || undefined,
      },
    }))
  }, [update])

  // 切到「跟随图片」时，旧图还没取过色就当场从 Haven 拉图补取一次
  const setAccentMode = useCallback(async (mode: 'theme' | 'photo') => {
    let accent = appearance.background.accent
    if (mode === 'photo' && !accent && appearance.background.assetId) {
      const response = await fetch(`/api/appearance/background?assetId=${encodeURIComponent(appearance.background.assetId)}`)
      if (!response.ok) throw new Error('读取背景图失败')
      accent = (await extractPhotoAccent(await response.blob())) || undefined
      if (!accent) throw new Error('这张图颜色太少，取不出强调色')
    }
    update(current => ({ ...current, background: { ...current.background, accentMode: mode, accent } }))
  }, [appearance.background.accent, appearance.background.assetId, update])

  const deleteBackground = useCallback(async () => {
    const response = await fetch('/api/appearance/background', { method: 'DELETE' })
    if (!response.ok) throw new Error('背景图删除失败')
    update(current => ({ ...current, background: { kind: 'gradient', intensity: current.background.intensity, accentMode: 'theme' } }))
  }, [update])

  return (
    <AppearanceContext.Provider value={{ appearance, status, update, uploadBackground, deleteBackground, setAccentMode }}>
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider')
  return context
}
