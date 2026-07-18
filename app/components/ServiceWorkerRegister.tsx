'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    // Only register SW in production; during dev, SW cache hides live changes
    if (window.location.hostname !== 'localhost' && !window.location.hostname.startsWith('127.')) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('SW registration failed (non-critical):', err.message)
      })
    }
  }, [])

  return null
}
