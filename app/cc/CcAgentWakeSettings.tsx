'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AgentWakeSchedule } from '@/app/lib/havenTurns'

type Payload = { ok?: boolean; schedule?: AgentWakeSchedule; error?: string }

const BUTTON = 'rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10.5px] text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
const ROW = 'flex items-center justify-between gap-3 py-2 text-[11px]'

function fmt(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
}

export default function CcAgentWakeSettings({ sessionId, laneId, busy }: {
  sessionId: string
  laneId: string
  busy: boolean
}) {
  const [schedule, setSchedule] = useState<AgentWakeSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ session_id: sessionId, lane_id: laneId })
      const response = await fetch(`/api/cc-agent-wake?${query.toString()}`, { cache: 'no-store' })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok || !payload.schedule) throw new Error(payload.error || '读取失败')
      setSchedule(payload.schedule)
    } catch (cause) {
      setError((cause as Error).message || '读取失败')
    } finally {
      setLoading(false)
    }
  }, [laneId, sessionId])

  useEffect(() => { void load() }, [load])

  const save = async (changes: Record<string, unknown>, action = 'update') => {
    if (!schedule) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/cc-agent-wake', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          lane_id: laneId,
          expected_version: schedule.schedule_version,
          action,
          changes,
        }),
      })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok || !payload.schedule) throw new Error(payload.error || '保存失败')
      setSchedule(payload.schedule)
    } catch (cause) {
      setError((cause as Error).message || '保存失败')
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-[11px] text-[var(--color-text-tertiary)]">正在读取主动唤醒状态…</div>
  if (!schedule) return <div className="text-[11px] text-[var(--color-danger)]">{error || '主动唤醒状态不可用'}</div>

  return (
    <div className="space-y-3 text-[11px] text-[var(--color-text-secondary)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] p-3 leading-relaxed">
        只影响当前 CC 线路。24 小时没有用户活动会停止固定保活，但不会删除 Claude 已安排的未来 wake。
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-3">
        <label className={ROW}>
          <span>允许 Claude 主动唤醒</span>
          <input type="checkbox" checked={schedule.agent_wake_enabled} disabled={saving || busy} onChange={event => void save({ agent_wake_enabled: event.target.checked })} />
        </label>
        <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>缓存保活</span>
          <input type="checkbox" checked={schedule.keepalive_enabled} disabled={saving || busy} onChange={event => void save({ keepalive_enabled: event.target.checked })} />
        </label>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>暂停到下次用户消息</span>
          <button className={BUTTON} disabled={saving || busy || schedule.keepalive_paused_until_user} onClick={() => void save({ keepalive_paused_until_user: true })}>
            {schedule.keepalive_paused_until_user ? '已暂停' : '暂停'}
          </button>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-3">
        <div className={ROW}><span>Cache 状态</span><span>{schedule.cache_state}</span></div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>最近 cache refresh</span><span>{fmt(schedule.last_cache_refresh_at)}</span></div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>下一次固定保活</span><span>{fmt(schedule.cache_keepalive_deadline)}</span></div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>本轮沉默检查</span><span>{fmt(schedule.conversation_silence_check_at)}</span></div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-3">
        <div className="font-medium text-[var(--color-text-heading)]">Claude 安排的下一次 wake</div>
        <div className="mt-1 text-[var(--color-text-tertiary)]">
          {schedule.next_agent_wake_at ? `${fmt(schedule.next_agent_wake_at)}${schedule.wake_reason ? ` · ${schedule.wake_reason}` : ''}` : '没有安排'}
        </div>
        {schedule.next_agent_wake_at ? (
          <button className={`${BUTTON} mt-2`} disabled={saving || busy} onClick={() => void save({}, 'cancel_next')}>取消下一次 wake</button>
        ) : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-3">
        <div className="font-medium text-[var(--color-text-heading)]">时间策略</div>
        <label className={`${ROW} mt-1`}>
          <span>主动 wake 最短间隔</span>
          <span><input className="w-16 rounded border border-[var(--color-border)] px-1.5 py-1 text-right" type="number" min={1} max={10080} value={schedule.agent_wake_min_minutes} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, agent_wake_min_minutes: Number(event.target.value) })} onBlur={() => void save({ agent_wake_min_minutes: schedule.agent_wake_min_minutes })} /> 分钟</span>
        </label>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>对话沉默检查</span>
          <span className="flex items-center gap-1">
            <input className="w-12 rounded border border-[var(--color-border)] px-1 py-1 text-right" type="number" min={1} max={1440} value={schedule.silence_min_minutes} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, silence_min_minutes: Number(event.target.value) })} />
            –
            <input className="w-12 rounded border border-[var(--color-border)] px-1 py-1 text-right" type="number" min={1} max={1440} value={schedule.silence_max_minutes} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, silence_max_minutes: Number(event.target.value) })} onBlur={() => void save({ silence_min_minutes: schedule.silence_min_minutes, silence_max_minutes: schedule.silence_max_minutes })} />
            分钟
          </span>
        </div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>后台 turn 上限</span><span>{schedule.background_turn_limit}/滚动 24h</span></div>
      </div>

      {schedule.last_error || error ? <div className="text-[var(--color-danger)]">{error || schedule.last_error}</div> : null}
      <button
        type="button"
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-[11px] text-[var(--color-danger)] disabled:opacity-50"
        disabled={saving || busy}
        onClick={() => { if (window.confirm('立即停止当前窗口的所有后台唤醒？')) void save({}, 'stop_all') }}
      >
        立即停止所有后台唤醒
      </button>
    </div>
  )
}
