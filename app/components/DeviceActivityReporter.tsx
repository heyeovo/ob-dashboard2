'use client'
import { useEffect } from 'react'

/** Removable standalone-PWA activity reporting; no browser token. */
export default function DeviceActivityReporter() {
  useEffect(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches) return
    const last: Partial<Record<'opened' | 'closed', number>> = {}
    const report = (event: 'opened' | 'closed') => {
      const now = Date.now()
      if (last[event] !== undefined && now - last[event]! < 30_000) return
      last[event] = now
      const body = JSON.stringify({ event_id: crypto.randomUUID(), event,
        occurred_at: new Date(now).toISOString(), app_id: 'home', app_name: '我们家', source: 'pwa' })
      const blob = new Blob([body], { type: 'application/json' })
      if (!navigator.sendBeacon?.('/api/device-events/self', blob)) {
        void fetch('/api/device-events/self', { method: 'POST', body, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
      }
    }
    const visible = () => report(document.visibilityState === 'visible' ? 'opened' : 'closed')
    const hidden = () => report('closed')
    visible()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', hidden)
    return () => {
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pagehide', hidden)
    }
  }, [])
  return null
}
