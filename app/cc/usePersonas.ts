'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FALLBACK_PERSONA,
  personaFromHaven,
  personaToPayload,
  type CcPersona,
} from './persona'

// 协作者列表 + 当前选中的那个。数据在 Haven，通过 /api/cc-personas 读写。
//
// 「当前选谁」存 localStorage —— 这一项是纯界面偏好（这台设备上次用的是谁），
// 不是配置数据，两台设备各记一份是对的，不算 Polaris 那个坑。
// 协作者本体（名字/提示词/记忆/引擎）全在 Haven。

const ACTIVE_KEY = 'ob2-cc-active-persona'

export function usePersonas() {
  const [personas, setPersonas] = useState<CcPersona[]>([])
  const [activeId, setActiveId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const bootRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/cc-personas', { cache: 'no-store' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '协作者配置读取失败')
      const list = Array.isArray(data.personas)
        ? (data.personas as Record<string, unknown>[]).map(personaFromHaven)
        : []
      setPersonas(list)
      setError('')
      return list
    } catch (e) {
      // 读不到就退回内置那个，聊天不能因为配置读不到就用不了
      setError((e as Error).message || '协作者配置读取失败')
      setPersonas([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // 首屏：拉列表 + 恢复上次选的那个
  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    void (async () => {
      const list = await refresh()
      let remembered = ''
      try {
        remembered = window.localStorage.getItem(ACTIVE_KEY) || ''
      } catch {
        /* 隐私模式下拿不到，无所谓 */
      }
      const hit = list.find(p => p.id === remembered)
      setActiveId(hit?.id || list[0]?.id || '')
    })()
  }, [refresh])

  const selectPersona = useCallback((id: string) => {
    setActiveId(id)
    try {
      window.localStorage.setItem(ACTIVE_KEY, id)
    } catch {
      /* 忽略 */
    }
  }, [])

  /** upsert 一个协作者（新建和改都走这里）。成功后本地列表就地更新，不重拉。 */
  const savePersona = useCallback(async (persona: CcPersona) => {
    setSaving(true)
    try {
      const res = await fetch('/api/cc-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(personaToPayload(persona)),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || '保存失败')
      const saved = data.persona ? personaFromHaven(data.persona as Record<string, unknown>) : persona
      setPersonas(prev => {
        const idx = prev.findIndex(p => p.id === saved.id)
        if (idx === -1) return [...prev, saved]
        const next = [...prev]
        next[idx] = saved
        return next
      })
      setError('')
      return { ok: true, persona: saved }
    } catch (e) {
      const message = (e as Error).message || '保存失败'
      setError(message)
      return { ok: false, persona: null, error: message }
    } finally {
      setSaving(false)
    }
  }, [])

  const deletePersona = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/cc-personas?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
        const data = await res.json()
        if (!data.ok) throw new Error(data.error || '删除失败')
        const rest = personas.filter(p => p.id !== id)
        setPersonas(rest)
        if (activeId === id) selectPersona(rest[0]?.id || '')
        return { ok: true }
      } catch (e) {
        const message = (e as Error).message || '删除失败'
        setError(message)
        return { ok: false, error: message }
      }
    },
    [personas, activeId, selectPersona],
  )

  const active = personas.find(p => p.id === activeId) || personas[0] || FALLBACK_PERSONA

  return {
    personas,
    active,
    activeId: active.id,
    loading,
    saving,
    error,
    refresh,
    selectPersona,
    savePersona,
    deletePersona,
  }
}
