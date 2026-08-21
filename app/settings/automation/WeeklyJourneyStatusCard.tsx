'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  AutomationRequestError,
  fetchDailyReviewStatus,
  fetchWeeklyJourneyStatus,
  runWeeklyJourney,
  updateAutomationExecution,
  updateWeeklyJourneySchedule,
  type AutomationStatus,
} from '../../lib/journeyAutomation'

type PersonaOption = { id: string; name?: string }
type DailyConfig = { enabled?: boolean; daily_hour?: number; daily_minute?: number }
type ExecutionEngine = 'api' | 'pro'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function displayTime(value?: string) {
  if (!value) return '尚无记录'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false })
}

function readableError(error: unknown) {
  if (error instanceof AutomationRequestError) return error.message
  return error instanceof Error ? error.message : String(error)
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default function WeeklyJourneyStatusCard() {
  const [weeklyStatus, setWeeklyStatus] = useState<AutomationStatus | null>(null)
  const [dailyStatus, setDailyStatus] = useState<AutomationStatus | null>(null)
  const [personas, setPersonas] = useState<PersonaOption[]>([])
  const [personaId, setPersonaId] = useState('')
  const [weeklyEnabled, setWeeklyEnabled] = useState(false)
  const [weekday, setWeekday] = useState(0)
  const [weeklyHour, setWeeklyHour] = useState(5)
  const [weeklyMinute, setWeeklyMinute] = useState(0)
  const [dailyEnabled, setDailyEnabled] = useState(true)
  const [dailyHour, setDailyHour] = useState(4)
  const [dailyMinute, setDailyMinute] = useState(30)
  const [dailyEngine, setDailyEngine] = useState<ExecutionEngine>('api')
  const [dailyModel, setDailyModel] = useState('claude-sonnet-4-6')
  const [weeklyEngine, setWeeklyEngine] = useState<ExecutionEngine>('api')
  const [weeklyModel, setWeeklyModel] = useState('claude-sonnet-4-6')
  const [loading, setLoading] = useState(true)
  const [savingDaily, setSavingDaily] = useState(false)
  const [savingWeekly, setSavingWeekly] = useState(false)
  const [running, setRunning] = useState(false)
  const [savingExecution, setSavingExecution] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [weekly, daily, personaResponse, configResponse] = await Promise.all([
        fetchWeeklyJourneyStatus(),
        fetchDailyReviewStatus(),
        fetch('/api/cc-personas', { cache: 'no-store' }),
        fetch('/api/config', { cache: 'no-store' }),
      ])
      const personaPayload = await personaResponse.json().catch(() => ({}))
      const configPayload = await configResponse.json().catch(() => ({}))
      if (!personaResponse.ok) throw new Error(personaPayload.error || '读取协作者失败')
      if (!configResponse.ok) throw new Error(configPayload.error || '读取日回顾设置失败')
      const rows = Array.isArray(personaPayload.personas) ? personaPayload.personas : []
      const weeklyPolicy = weekly.schedule?.policy || {}
      const dailyConfig = (configPayload.daily_review || {}) as DailyConfig
      setWeeklyStatus(weekly)
      setDailyStatus(daily)
      setPersonas(rows)
      setWeeklyEnabled(Boolean(weekly.schedule?.enabled))
      setWeekday(numberValue(weeklyPolicy.weekday, 0))
      setWeeklyHour(numberValue(weeklyPolicy.hour, 5))
      setWeeklyMinute(numberValue(weeklyPolicy.minute, 0))
      setPersonaId(String(weeklyPolicy.persona_id || (rows.length === 1 ? rows[0].id || '' : '')))
      setDailyEnabled(dailyConfig.enabled !== false)
      setDailyHour(numberValue(dailyConfig.daily_hour, 4))
      setDailyMinute(numberValue(dailyConfig.daily_minute, 30))
      setDailyEngine(daily.schedule?.execution_engine === 'pro' ? 'pro' : 'api')
      setDailyModel(String(daily.schedule?.execution_model || 'claude-sonnet-4-6'))
      setWeeklyEngine(weekly.schedule?.execution_engine === 'pro' ? 'pro' : 'api')
      setWeeklyModel(String(weekly.schedule?.execution_model || 'claude-sonnet-4-6'))
    } catch (loadError) {
      setError(readableError(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const saveDaily = async () => {
    setSavingDaily(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persist: true,
          daily_review: { enabled: dailyEnabled, daily_hour: dailyHour, daily_minute: dailyMinute },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) throw new Error(payload.error || '保存日回顾时间失败')
      setNotice('日回顾时间已保存并立即生效。')
      await load()
    } catch (saveError) { setError(readableError(saveError)) } finally { setSavingDaily(false) }
  }

  const saveWeekly = async () => {
    if (weeklyEnabled && !personaId) { setError('启用 weekly journey 前请先选择协作者。'); return }
    setSavingWeekly(true); setError(''); setNotice('')
    try {
      await updateWeeklyJourneySchedule({
        enabled: weeklyEnabled, weekday, hour: weeklyHour, minute: weeklyMinute, personaId,
      })
      setNotice('每周关系轨迹时间已保存并立即生效。')
      await load()
    } catch (saveError) { setError(readableError(saveError)) } finally { setSavingWeekly(false) }
  }

  const runNow = async () => {
    if (!personaId) { setError('请先选择本次候选使用的协作者。'); return }
    setRunning(true); setError(''); setNotice('')
    try {
      const result = await runWeeklyJourney(personaId)
      setNotice(result.status === 'exists' ? '相同周次和输入已经有候选，没有重复创建。' : result.status === 'running' ? '这次候选正在生成，请稍后刷新状态。' : '候选已经生成，等待你到关系轨迹页审核。')
      await load()
    } catch (runError) { await load(); setError(readableError(runError)) } finally { setRunning(false) }
  }

  const saveExecution = async (
    taskType: 'daily_review' | 'weekly_journey',
    engine: ExecutionEngine,
    model: string,
  ) => {
    setSavingExecution(taskType); setError(''); setNotice('')
    try {
      await updateAutomationExecution(taskType, engine, model)
      setNotice(`${taskType === 'daily_review' ? '日回顾' : '每周关系轨迹'}执行方式已保存；下一次运行生效。`)
      await load()
    } catch (saveError) { setError(readableError(saveError)) } finally { setSavingExecution('') }
  }

  if (loading) return <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white py-8 text-center text-sm text-[var(--color-text-disabled)]">读取自动化调度中…</div>
  if (error && !weeklyStatus) return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={() => void load()} className="ml-3 underline">重试</button></div>

  const weeklySchedule = weeklyStatus?.schedule || {}
  const dailySchedule = dailyStatus?.schedule || {}
  const weeklyLatest = weeklyStatus?.latest_run || {}
  const dailyExecution = dailyStatus?.latest_execution || {}
  const weeklyExecution = weeklyStatus?.latest_execution || {}

  const executionControls = (
    taskType: 'daily_review' | 'weekly_journey',
    engine: ExecutionEngine,
    setEngine: (value: ExecutionEngine) => void,
    model: string,
    setModel: (value: string) => void,
    latest: NonNullable<AutomationStatus['latest_execution']>,
  ) => (
    <div className="mt-3 rounded-xl border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--color-text-tertiary)]">执行方式
          <select value={engine} onChange={event => setEngine(event.target.value as ExecutionEngine)} className="mt-1 block rounded-md border bg-white px-2 py-2 text-sm">
            <option value="api">API</option><option value="pro">Claude Pro</option>
          </select>
        </label>
        {engine === 'pro' ? <label className="text-xs text-[var(--color-text-tertiary)]">Pro 模型
          <select value={model} onChange={event => setModel(event.target.value)} className="mt-1 block rounded-md border bg-white px-2 py-2 text-sm">
            <option value="claude-sonnet-4-6">Sonnet 4.6</option><option value="claude-opus-4-6">Opus 4.6</option>
          </select>
        </label> : <div className="pb-2 text-xs text-[var(--color-text-disabled)]">沿用“模型设置”中的当前 API 连接</div>}
        <button onClick={() => void saveExecution(taskType, engine, model)} disabled={savingExecution === taskType} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-40">{savingExecution === taskType ? '保存中…' : '保存执行方式'}</button>
      </div>
      <div className="mt-2 text-[10.5px] leading-5 text-[var(--color-text-disabled)]">不会自动 fallback；失败后先在这里人工换线，再手动重试。</div>
      {latest.started_at ? <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${latest.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'}`}>
        最近实际执行：{latest.actual_engine === 'pro' ? 'Claude Pro' : 'API'} · {latest.model || '默认模型'} · {latest.status === 'failed' ? `失败（${latest.error_code || 'model_error'}）：${latest.error || '未知错误'}` : '完成'} · {displayTime(latest.completed_at || latest.started_at)}
      </div> : null}
    </div>
  )

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-[var(--color-text-heading)]">独立日回顾</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">每天按香港时间统计 04:00–次日 04:00；生成结果归到开始日，不进入普通记忆桶。</p>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">日界线</div><div className="mt-1 text-sm">04:00（固定）</div></div>
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">上次运行</div><div className="mt-1 text-sm">{displayTime(dailySchedule.last_run_at)}</div></div>
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">下次运行</div><div className="mt-1 text-sm">{dailyEnabled ? displayTime(dailySchedule.next_run_at) : '已停用'}</div></div>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] p-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dailyEnabled} onChange={event => setDailyEnabled(event.target.checked)} />启用每日生成</label>
          <label className="text-xs text-[var(--color-text-tertiary)]">小时<input type="number" min={0} max={23} value={dailyHour} onChange={event => setDailyHour(numberValue(event.target.value, 4))} className="mt-1 block w-20 rounded-md border px-2 py-2 text-sm" /></label>
          <label className="text-xs text-[var(--color-text-tertiary)]">分钟<input type="number" min={0} max={59} value={dailyMinute} onChange={event => setDailyMinute(numberValue(event.target.value, 30))} className="mt-1 block w-20 rounded-md border px-2 py-2 text-sm" /></label>
          <button onClick={() => void saveDaily()} disabled={savingDaily} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{savingDaily ? '保存中…' : '保存日回顾时间'}</button>
        </div>
        {executionControls('daily_review', dailyEngine, setDailyEngine, dailyModel, setDailyModel, dailyExecution)}
        {dailySchedule.last_error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">最近运行失败：{dailySchedule.last_error}</div>}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-[var(--color-text-heading)]">每周关系轨迹候选</h2><span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">只生成候选</span></div><p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">周范围固定为周一 04:00–下周一 04:00；定时运行绝不自动确认或写入 journey。</p></div>
          <Link href="/journey" className="text-xs text-[var(--color-primary)]">去审核候选 →</Link>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">待确认</div><div className="mt-1 text-sm">{weeklyStatus?.pending_candidates ?? 0} 条</div></div>
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">最近运行</div><div className="mt-1 text-sm">{displayTime(weeklySchedule.last_run_at || weeklyLatest.started_at)}</div></div>
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">下次运行</div><div className="mt-1 text-sm">{weeklyEnabled ? displayTime(weeklySchedule.next_run_at) : '已停用'}</div></div>
          <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">时区</div><div className="mt-1 text-sm">Asia/Hong_Kong（固定）</div></div>
        </div>
        <div className="grid gap-3 rounded-xl border border-[var(--color-border)] p-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={weeklyEnabled} onChange={event => setWeeklyEnabled(event.target.checked)} />启用每周生成</label>
          <label className="text-xs text-[var(--color-text-tertiary)]">星期<select value={weekday} onChange={event => setWeekday(numberValue(event.target.value, 0))} className="mt-1 block w-full rounded-md border bg-white px-2 py-2 text-sm">{WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
          <label className="text-xs text-[var(--color-text-tertiary)]">小时<input type="number" min={0} max={23} value={weeklyHour} onChange={event => setWeeklyHour(numberValue(event.target.value, 5))} className="mt-1 block w-full rounded-md border px-2 py-2 text-sm" /></label>
          <label className="text-xs text-[var(--color-text-tertiary)]">分钟<input type="number" min={0} max={59} value={weeklyMinute} onChange={event => setWeeklyMinute(numberValue(event.target.value, 0))} className="mt-1 block w-full rounded-md border px-2 py-2 text-sm" /></label>
          <label className="text-xs text-[var(--color-text-tertiary)]">协作者<select value={personaId} onChange={event => setPersonaId(event.target.value)} className="mt-1 block w-full rounded-md border bg-white px-2 py-2 text-sm"><option value="">请选择</option>{personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name || persona.id}</option>)}</select></label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><button onClick={() => void saveWeekly()} disabled={savingWeekly} className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{savingWeekly ? '保存中…' : '保存每周时间'}</button><button onClick={() => void runNow()} disabled={running || !personaId} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-40">{running ? '正在生成…' : '立即生成候选'}</button></div>
        </div>
        {executionControls('weekly_journey', weeklyEngine, setWeeklyEngine, weeklyModel, setWeeklyModel, weeklyExecution)}
        {weeklySchedule.last_error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">最近运行失败：{weeklySchedule.last_error}</div>}
      </section>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
    </div>
  )
}
