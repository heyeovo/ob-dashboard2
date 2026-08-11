'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  AutomationRequestError,
  fetchWeeklyJourneyStatus,
  runWeeklyJourney,
  type AutomationStatus,
} from '../../lib/journeyAutomation'

type PersonaOption = { id: string; name?: string }

function displayTime(value?: string) {
  if (!value) return '尚无记录'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false })
}

function readableError(error: unknown) {
  if (error instanceof AutomationRequestError) return error.message
  return error instanceof Error ? error.message : String(error)
}

export default function WeeklyJourneyStatusCard() {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const [personas, setPersonas] = useState<PersonaOption[]>([])
  const [personaId, setPersonaId] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [automation, personaResponse] = await Promise.all([
        fetchWeeklyJourneyStatus(),
        fetch('/api/cc-personas', { cache: 'no-store' }),
      ])
      const personaPayload = await personaResponse.json().catch(() => ({}))
      if (!personaResponse.ok) throw new Error(personaPayload.error || '读取协作者失败')
      const rows = Array.isArray(personaPayload.personas) ? personaPayload.personas : []
      setStatus(automation)
      setPersonas(rows)
      setPersonaId(current => current || (rows.length === 1 ? String(rows[0].id || '') : ''))
    } catch (loadError) {
      setError(readableError(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runNow = async () => {
    if (!personaId) {
      setError('请先选择本次候选使用的协作者。')
      return
    }
    setRunning(true)
    setError('')
    setNotice('')
    try {
      const result = await runWeeklyJourney(personaId)
      if (result.status === 'exists') {
        setNotice('相同周次和输入已经有候选，没有重复创建。')
      } else if (result.status === 'running') {
        setNotice('这次候选正在生成，请稍后刷新状态。')
      } else {
        setNotice('候选已经生成，等待你到关系轨迹页审核。')
      }
      await load()
    } catch (runError) {
      const message = readableError(runError)
      await load()
      setError(message)
    } finally {
      setRunning(false)
    }
  }

  const latest = status?.latest_run || {}
  const schedule = status?.schedule || {}
  const latestError = String(latest.error || '')

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-[var(--color-text-heading)]">每周关系轨迹候选</h2>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">只生成候选</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${schedule.enabled ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {schedule.enabled ? '调度已启用' : '定时调度未启用'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">当前只有手动生成入口；本页没有自动写入或开启定时调度的开关。</p>
        </div>
        <Link href="/journey" className="text-xs text-[var(--color-primary)]">去审核候选 →</Link>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-disabled)]">读取 weekly journey 状态中…</div>
      ) : error && !status ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          <button onClick={() => void load()} className="ml-3 underline">重试</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">时区</div><div className="mt-1 text-sm">{schedule.timezone || latest.timezone || 'Asia/Hong_Kong'}</div></div>
            <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">待确认</div><div className="mt-1 text-sm">{status?.pending_candidates ?? 0} 条</div></div>
            <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">最近运行</div><div className="mt-1 text-sm">{displayTime(latest.started_at)}</div></div>
            <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">下次运行</div><div className="mt-1 text-sm">{schedule.enabled ? displayTime(schedule.next_run_at) : '未安排'}</div></div>
          </div>

          {latest.run_id && (
            <div className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
              最近状态：{latest.status || '未知'}；周期：{latest.cycle_key || '未标注'}；触发方式：{latest.trigger || 'manual'}
            </div>
          )}
          {latestError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">最近运行失败：{latestError}</div>}
          {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">{notice}</div>}
          {error && status && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</div>}

          <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">本次协作者</span>
              <select value={personaId} onChange={event => setPersonaId(event.target.value)} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm">
                <option value="">请选择协作者</option>
                {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name || persona.id}（{persona.id}）</option>)}
              </select>
            </label>
            <button onClick={() => void runNow()} disabled={running || !personaId} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
              {running ? '正在生成候选…' : '立即生成候选'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
