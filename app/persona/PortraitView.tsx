'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import PersonaTabs from './PersonaTabs'
import PortraitStateCard from './PortraitStateCard'
import ProfileFactsSection from './ProfileFactsSection'
import PortraitProposalsSection from './PortraitProposalsSection'
import { portraitApi } from './portraitApi'
import type { PortraitStatePayload, ProfileFact } from './portraitTypes'

/**
 * 画像 tab（/persona?tab=portrait）容器。
 * 并行加载 portrait state + profile facts，持有顶部动作条（刷新 / 手动生成 / 清空画像）。
 * 三个区块组件各自管自己的写操作与消息，容器只做数据编排。
 */
export default function PortraitView() {
  const [state, setState] = useState<PortraitStatePayload | null>(null)
  const [facts, setFacts] = useState<ProfileFact[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [stateRes, factsRes] = await Promise.all([portraitApi.getState(), portraitApi.getFacts()])
    setState(stateRes)
    setFacts(factsRes.facts)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取画像状态失败')
    } finally {
      setLoading(false)
    }
  }, [reload])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const runMaintain = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await portraitApi.maintain()
      await reload()
      setNotice({ kind: 'ok', text: `已生成画像：${res.status || ''}`.trim() })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : '生成失败' })
    } finally {
      setBusy(false)
    }
  }

  const runReset = async () => {
    const typed = window.prompt('输入 RESET 清空 Portrait State。下一次手动生成会按第一次生成运行。')
    if (typed !== 'RESET') return
    setBusy(true)
    setNotice(null)
    try {
      await portraitApi.reset()
      await reload()
      setNotice({ kind: 'ok', text: '已清空画像；下一次手动生成会按第一次生成。' })
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : '清空失败' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-tertiary)] hover:bg-black/5">
              ← Home
            </Link>
            <div>
              <h1 className="text-base font-semibold">Persona 中心</h1>
              <p className="hidden text-xs text-[var(--color-text-disabled)] sm:block">
                后台每天维护的换窗画像；只在 breath/handoff 开场恢复
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void load()}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] disabled:opacity-50"
            >
              刷新
            </button>
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void runMaintain()}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] disabled:opacity-50"
            >
              {busy ? '生成中…' : '手动生成'}
            </button>
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void runReset()}
              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-[var(--color-danger)] hover:bg-rose-50 disabled:opacity-50"
            >
              清空画像
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 lg:py-8">
        <PersonaTabs active="portrait" />

        {notice && (
          <div
            className={`mb-4 rounded-[var(--radius-lg)] border px-4 py-3 text-sm ${
              notice.kind === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {notice.text}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white px-4 py-16 text-center text-sm text-[var(--color-text-disabled)]">
            正在从 Haven 读取画像状态…
          </div>
        ) : error ? (
          <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>读取失败：{error}</p>
            <button
              type="button"
              className="mt-3 rounded-[var(--radius-md)] border border-red-300 bg-white px-3 py-1.5 text-xs"
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {state && <PortraitStateCard state={state} onReload={() => void reload()} />}
            <ProfileFactsSection facts={facts} onChanged={() => void reload()} />
            <PortraitProposalsSection onFactsChanged={() => void reload()} />
          </div>
        )}
      </main>
    </>
  )
}
