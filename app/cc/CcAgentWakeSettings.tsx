'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { AgentWakeSchedule, BarkNotificationConfig, BarkNotificationRecent } from '@/app/lib/havenTurns'

type Payload = { ok?: boolean; schedule?: AgentWakeSchedule; error?: string }
type NotificationPayload = {
  ok?: boolean
  config?: BarkNotificationConfig
  recent?: BarkNotificationRecent | null
  error?: string
}

const BUTTON = 'rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-2xs text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50'
const ROW = 'flex items-center justify-between gap-3 py-2 text-meta'

function fmt(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—'
}

function notificationStatus(value: BarkNotificationRecent['status']) {
  return ({
    pending: '等待发送',
    sending: '正在发送',
    retrying: '等待重试',
    sent: '发送成功',
    failed: '发送失败',
  } as const)[value] || value
}

export default function CcAgentWakeSettings({ sessionId, laneId, busy, isGpt = false }: {
  sessionId: string
  laneId: string
  busy: boolean
  isGpt?: boolean
}) {
  const [schedule, setSchedule] = useState<AgentWakeSchedule | null>(null)
  const latestSchedule = useRef<AgentWakeSchedule | null>(null)
  const gptSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notificationReady, setNotificationReady] = useState(false)
  const [notificationRecent, setNotificationRecent] = useState<BarkNotificationRecent | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ session_id: sessionId, lane_id: laneId })
      const [response, notificationResponse] = await Promise.all([
        fetch(`/api/cc-agent-wake?${query.toString()}`, { cache: 'no-store' }),
        fetch(`/api/cc-notifications?${query.toString()}`, { cache: 'no-store' }),
      ])
      const [payload, notificationPayload] = await Promise.all([
        response.json() as Promise<Payload>,
        notificationResponse.json() as Promise<NotificationPayload>,
      ])
      if (!response.ok || !payload.ok || !payload.schedule) throw new Error(payload.error || '读取失败')
      latestSchedule.current = payload.schedule
      setSchedule(payload.schedule)
      if (notificationResponse.ok && notificationPayload.ok && notificationPayload.config) {
        setNotificationReady(notificationPayload.config.ready)
        setNotificationRecent(notificationPayload.recent || null)
      }
    } catch (cause) {
      setError((cause as Error).message || '读取失败')
    } finally {
      setLoading(false)
    }
  }, [laneId, sessionId])

  useEffect(() => { void load() }, [load])

  const save = async (changes: Record<string, unknown>, action = 'update') => {
    if (!schedule) return
    const patch = async (version: number) => {
      const response = await fetch('/api/cc-agent-wake', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId, lane_id: laneId, expected_version: version, action, changes,
        }),
      })
      return { response, payload: await response.json() as Payload }
    }
    const perform = async () => {
      setError('')
      try {
        let result = await patch((isGpt ? latestSchedule.current ?? schedule : schedule).schedule_version)
        if (isGpt && result.response.status === 409) {
          const query = new URLSearchParams({ session_id: sessionId, lane_id: laneId })
          const response = await fetch(`/api/cc-agent-wake?${query.toString()}`, { cache: 'no-store' })
          const fresh = await response.json() as Payload
          if (response.ok && fresh.ok && fresh.schedule) result = await patch(fresh.schedule.schedule_version)
        }
        const { response, payload } = result
        if (!response.ok || !payload.ok || !payload.schedule) throw new Error(payload.error || '保存失败')
        latestSchedule.current = payload.schedule
        setSchedule(payload.schedule)
      } catch (cause) {
        if (!isGpt) await load()
        setError((cause as Error).message || '保存失败')
      }
    }

    setSaving(true)
    if (!isGpt) {
      try { await perform() } finally { setSaving(false) }
      return
    }
    const pending = gptSaveQueue.current.then(perform)
    gptSaveQueue.current = pending
    await pending
    if (gptSaveQueue.current === pending) setSaving(false)
  }

  if (loading) return <div className="text-meta text-[var(--color-text-tertiary)]">正在读取主动唤醒状态…</div>
  if (!schedule) return <div className="text-meta text-[var(--color-danger)]">{error || '主动唤醒状态不可用'}</div>

  return (
    <div aria-busy={saving} className="space-y-3 text-meta text-[var(--color-text-secondary)]">
      {!isGpt && <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] p-3 leading-relaxed">
        只影响当前 CC 线路。暂停后，下一条用户消息或 Claude 正式主动消息会恢复固定保活；24 小时没有用户活动也会自动暂停，但不会删除 Claude 已安排的未来 wake。
      </div>}

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-3">
        {isGpt ? <>
          <label className={ROW}>
            <span>长沉默唤醒</span>
            <input type="checkbox" checked={schedule.long_silence_enabled} disabled={busy}
              onChange={event => void save({ long_silence_enabled: event.target.checked })} />
          </label>
          <WakeHours label="第一次唤醒（小时）" hours={schedule.long_silence_first_hours ?? 2}
            disabled={busy} onSave={hours => void save({ long_silence_first_hours: hours })} />
          <WakeHours label="第二次唤醒（小时）" hours={schedule.long_silence_second_hours ?? 6}
            disabled={busy} onSave={hours => void save({ long_silence_second_hours: hours })} />
          <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
            <span>随机唤醒（每天两次）</span>
            <input type="checkbox" checked={schedule.random_wake_enabled} disabled={busy}
              onChange={event => void save({ random_wake_enabled: event.target.checked })} />
          </label>
        </> : <>
        <label className={ROW}>
          <span>允许 Claude 主动唤醒</span>
          <input type="checkbox" checked={schedule.agent_wake_enabled} disabled={saving || busy} onChange={event => void save({ agent_wake_enabled: event.target.checked })} />
        </label>
        <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>缓存保活</span>
          <input type="checkbox" checked={schedule.keepalive_enabled} disabled={saving || busy} onChange={event => void save({ keepalive_enabled: event.target.checked })} />
        </label>
        <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>对话沉默检查</span>
          <input type="checkbox" checked={schedule.conversation_silence_enabled} disabled={saving || busy} onChange={event => void save({ conversation_silence_enabled: event.target.checked })} />
        </label>
        </>}
        <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>主动消息推送到 Bark</span>
          <input type="checkbox" checked={schedule.bark_notification_enabled} disabled={(!isGpt && saving) || busy || !notificationReady} onChange={event => void save({ bark_notification_enabled: event.target.checked })} />
        </label>
        {!notificationReady ? (
          <div className="border-t border-[var(--color-border-light)] py-2 text-2xs text-[var(--color-text-tertiary)]">
            请先到 <Link href="/settings/notifications" className="underline">设置 → 通知</Link> 完成 Bark 配置。
          </div>
        ) : null}
        {!isGpt && <div className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>暂停到下次对话活动</span>
          <button className={BUTTON} disabled={saving || busy || schedule.keepalive_paused_until_user} onClick={() => void save({ keepalive_paused_until_user: true })}>
            {schedule.keepalive_paused_until_user ? '已暂停' : '暂停'}
          </button>
        </div>}
      </div>

      {!isGpt && <>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-3">
        <div className={ROW}><span>Cache 状态</span><span>{schedule.cache_state}</span></div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>最近 cache refresh</span><span>{fmt(schedule.last_cache_refresh_at)}</span></div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>下一次固定保活</span><span>{schedule.keepalive_enabled ? fmt(schedule.cache_keepalive_deadline) : '未开启'}</span></div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>本轮沉默检查</span><span>{fmt(schedule.conversation_silence_check_at)}</span></div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-3">
        <div className="font-medium text-[var(--color-text-heading)]">Claude 安排的下一次 wake</div>
        <div className="mt-1 text-[var(--color-text-tertiary)]">
          {schedule.next_agent_wake_at ? `${fmt(schedule.next_agent_wake_at)}${schedule.wake_reason ? ` · ${schedule.wake_reason}` : ''}${(schedule.alarms?.length || 0) > 1 ? ` · 共 ${schedule.alarms!.length} 条` : ''}` : '没有安排'}
        </div>
        {schedule.next_agent_wake_at ? (
          <button className={`${BUTTON} mt-2`} disabled={saving || busy} onClick={() => void save({}, 'cancel_next')}>取消全部闹钟</button>
        ) : null}
        {schedule.followup_at ? (
          <div className="mt-2 pt-2 border-t border-[var(--color-border-light)]">
            <div className="text-2xs text-[var(--color-text-tertiary)]">Followup · {fmt(schedule.followup_at)} · 她回复后自动取消 · {schedule.followup_count ?? 0}/{schedule.followup_max_count ?? 3}</div>
          </div>
        ) : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-3">
        <div className="font-medium text-[var(--color-text-heading)]">最近 Bark 推送</div>
        <div className="mt-1 text-[var(--color-text-tertiary)]">
          {notificationRecent
            ? `${notificationStatus(notificationRecent.status)} · ${notificationRecent.sent_count}/${notificationRecent.total_count} · ${fmt(notificationRecent.sent_at || notificationRecent.updated_at)}`
            : '还没有发送记录'}
        </div>
        {notificationRecent?.last_error ? <div className="mt-1 text-[var(--color-danger)]">{notificationRecent.last_error}</div> : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-3">
        <div className="font-medium text-[var(--color-text-heading)]">时间策略</div>
        <label className={`${ROW} mt-1`}>
          <span>主动 wake 最短间隔</span>
          <span><input className="w-16 rounded border border-[var(--color-border)] px-1.5 py-1 text-right" type="number" min={1} max={10080} value={schedule.agent_wake_min_minutes} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, agent_wake_min_minutes: Number(event.target.value) })} onBlur={() => void save({ agent_wake_min_minutes: schedule.agent_wake_min_minutes })} /> 分钟</span>
        </label>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>沉默检查时间范围</span>
          <span className="flex items-center gap-1">
            <input className="w-12 rounded border border-[var(--color-border)] px-1 py-1 text-right" type="number" min={1} max={1440} value={schedule.silence_min_minutes} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, silence_min_minutes: Number(event.target.value) })} />
            –
            <input className="w-12 rounded border border-[var(--color-border)] px-1 py-1 text-right" type="number" min={1} max={1440} value={schedule.silence_max_minutes} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, silence_max_minutes: Number(event.target.value) })} onBlur={() => void save({ silence_min_minutes: schedule.silence_min_minutes, silence_max_minutes: schedule.silence_max_minutes })} />
            分钟
          </span>
        </div>
        <div className={`${ROW} border-t border-[var(--color-border-light)]`}><span>后台 turn 上限</span><span>{schedule.background_turn_limit}/滚动 24h</span></div>
        <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>Followup 最短间隔</span>
          <span><input className="w-16 rounded border border-[var(--color-border)] px-1.5 py-1 text-right" type="number" min={1} max={60} value={schedule.followup_min_minutes ?? 3} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, followup_min_minutes: Number(event.target.value) })} onBlur={() => void save({ followup_min_minutes: schedule.followup_min_minutes })} /> 分钟</span>
        </label>
        <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
          <span>Followup 最大追问次数</span>
          <span><input className="w-16 rounded border border-[var(--color-border)] px-1.5 py-1 text-right" type="number" min={1} max={10} value={schedule.followup_max_count ?? 3} disabled={saving || busy} onChange={event => setSchedule({ ...schedule, followup_max_count: Number(event.target.value) })} onBlur={() => void save({ followup_max_count: schedule.followup_max_count })} /> 次</span>
        </label>
      </div>

      </>}
      {schedule.last_error || error ? <div className="text-[var(--color-danger)]">{error || schedule.last_error}</div> : null}
      <button
        type="button"
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-meta text-[var(--color-danger)] disabled:opacity-50"
        disabled={saving || (busy && !isGpt)}
        onClick={() => { if (window.confirm('立即停止当前窗口的所有后台唤醒？')) void save({}, 'stop_all') }}
      >
        立即停止所有后台唤醒
      </button>
    </div>
  )
}

function WakeHours({ label, hours, disabled, onSave }: {
  label: string
  hours: number
  disabled: boolean
  onSave: (hours: number) => void
}) {
  const [draft, setDraft] = useState(String(hours))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { setDraft(String(hours)) }, [hours])
  useEffect(() => () => clearTimeout(timer.current), [])

  function commit(value: string) {
    clearTimeout(timer.current)
    timer.current = undefined
    const number = Number(value)
    if (!disabled && Number.isFinite(number) && number > 0 && number !== hours) onSave(number)
  }

  return <label className={`${ROW} border-t border-[var(--color-border-light)]`}>
    <span>{label}</span>
    <input type="number" inputMode="decimal" step="any" min={0}
      value={draft} disabled={disabled}
      aria-invalid={draft !== '' && !(Number.isFinite(Number(draft)) && Number(draft) > 0)}
      className="w-24 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-right text-body"
      onChange={event => {
        const value = event.target.value
        setDraft(value)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => commit(value), 450)
      }}
      onBlur={() => { if (timer.current) commit(draft) }} />
  </label>
}
