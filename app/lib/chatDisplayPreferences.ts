'use client'

import { useSyncExternalStore } from 'react'

const RUNTIME_KEY = 'ob2-chat-show-runtime-info'
const TOKEN_KEY = 'ob2-chat-show-token-info'

const listeners = new Set<() => void>()
let storageListening = false

function readBoolean(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key)
    if (value === null) return fallback
    return value === '1'
  } catch {
    return fallback
  }
}

function notify() {
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent) {
  if (event.key === RUNTIME_KEY || event.key === TOKEN_KEY) notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!storageListening) {
    window.addEventListener('storage', onStorage)
    storageListening = true
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && storageListening) {
      window.removeEventListener('storage', onStorage)
      storageListening = false
    }
  }
}

function setBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* 隐私模式或禁用存储时保持当前页面默认值 */
  }
  notify()
}

export function useChatDisplayPreferences() {
  const showRuntimeInfo = useSyncExternalStore(
    subscribe,
    () => readBoolean(RUNTIME_KEY, false),
    () => false,
  )
  const showTokenInfo = useSyncExternalStore(
    subscribe,
    () => readBoolean(TOKEN_KEY, true),
    () => true,
  )

  return {
    showRuntimeInfo,
    showTokenInfo,
    setShowRuntimeInfo: (value: boolean) => setBoolean(RUNTIME_KEY, value),
    setShowTokenInfo: (value: boolean) => setBoolean(TOKEN_KEY, value),
  }
}
