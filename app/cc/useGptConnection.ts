'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GptConnectionResponse, GptModelsResponse, GptConnectionFailure } from './types'
import { gptConnectionReady } from './gptConnectionUi'

const failure = (status?: number): GptConnectionFailure => ({ ok: false, error: {
  code: status === 401 ? 'dashboard_login_required' : 'connection_read_failed',
  message: status === 401 ? '页面登录已失效，请重新登录此页面。' : '未能确认 GPT 连接状态，请刷新重试。',
  action: 'retry', retryable: true, status,
} })
async function read<T extends GptConnectionResponse | GptModelsResponse>(
  operation: 'connection' | 'models', signal: AbortSignal,
): Promise<T | GptConnectionFailure> {
  try {
    const response = await fetch(`/api/gpt-subscription/${operation}`, { cache: 'no-store', signal })
    const value = await response.json()
    if (value?.ok === false && value.error?.message) return value as GptConnectionFailure
    return response.ok && value?.ok === true ? value as T : failure(response.status)
  } catch { return failure() }
}

export function useGptConnection(enabled: boolean) {
  const [connection, setConnection] = useState<GptConnectionResponse | null>(null)
  const [models, setModels] = useState<GptModelsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const reload = useCallback(async () => {
    controller.current?.abort()
    const ac = new AbortController(); controller.current = ac
    const id = ++generation.current
    setLoading(true); setConnection(null); setModels(null)
    const state = await read<GptConnectionResponse>('connection', ac.signal)
    if (!mounted.current || ac.signal.aborted || generation.current !== id) return
    setConnection(state)
    if (gptConnectionReady(state)) {
      const catalogue = await read<GptModelsResponse>('models', ac.signal)
      if (!mounted.current || ac.signal.aborted || generation.current !== id) return
      setModels(catalogue)
    }
    if (mounted.current && generation.current === id) setLoading(false)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort(); ++generation.current }
  }, [])
  useEffect(() => { if (enabled) void reload() }, [enabled, reload])

  return { connection, models, loading, reload, ready: !loading && gptConnectionReady(connection) }
}
