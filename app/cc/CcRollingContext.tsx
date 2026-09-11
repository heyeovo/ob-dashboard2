'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ConversationContextDay,
  HavenConversationSession,
  RollingContextConfig,
} from '@/app/lib/havenTurns'

type Props = {
  sessionId: string
  personaId: string
  busy: boolean
}

const SELECT = 'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)]'

function defaultModes(days: ConversationContextDay[]): Record<string, 'raw' | 'review' | 'omit'> {
  const newest = [...days].sort((a, b) => b.day.localeCompare(a.day))
  let rawDays = 0
  let reviewDays = 0
  return Object.fromEntries(newest.map(day => {
    if (day.turn_count > 0 && rawDays < 3) {
      rawDays += 1
      return [day.day, 'raw']
    }
    if (day.review && reviewDays < 10) {
      reviewDays += 1
      return [day.day, 'review']
    }
    return [day.day, 'omit']
  }))
}

export default function CcRollingContext({ sessionId, personaId, busy }: Props) {
  const [session, setSession] = useState<HavenConversationSession | null>(null)
  const [days, setDays] = useState<ConversationContextDay[]>([])
  const [draft, setDraft] = useState<RollingContextConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/cc-turns?session_id=${encodeURIComponent(sessionId)}&limit=1&context_days=1`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok || !data.ok || !data.session) throw new Error(data.error || '读取失败')
        if (cancelled) return
        setSession(data.session)
        setDays(Array.isArray(data.context_days) ? data.context_days : [])
        setDraft(data.session.rolling_context)
      })
      .catch(error => { if (!cancelled) setNote(error instanceof Error ? error.message : '读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const estimatedChars = useMemo(() => days.reduce((total, day) => {
    const mode = draft?.day_modes?.[day.day] || (draft?.strategy === 'daily_rolling' ? 'raw' : 'omit')
    if (mode === 'raw') return total + day.raw_chars
    if (mode === 'review') return total + (day.review?.chars || 0)
    return total
  }, 0), [days, draft])

  if (loading) return <div className="py-8 text-center text-[11px] text-[var(--color-text-disabled)]">读取上下文日期…</div>
  if (!draft || !session) return <div className="text-[11px] text-red-600">{note || '没有可用的窗口配置'}</div>

  const updateStrategy = (strategy: RollingContextConfig['strategy']) => {
    setDraft(current => current ? {
      ...current,
      strategy,
      day_modes: strategy === 'daily_rolling' && Object.keys(current.day_modes || {}).length === 0
        ? defaultModes(days)
        : current.day_modes,
    } : current)
    setNote('')
  }

  const save = async () => {
    if (busy) return
    setSaving(true)
    setNote('')
    try {
      const response = await fetch('/api/cc-turns', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          persona_id: personaId,
          expected_state_version: session.state_version,
          rolling_context: draft,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok || !data.session) throw new Error(data.error || '保存失败')
      setSession(data.session)
      setDraft(data.session.rolling_context)
      setNote(`已保存 · 版本 ${data.session.context_revision}。下一句话会使用这份上下文。`)
    } catch (error) {
      setNote(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-2 text-[11px] text-[var(--color-text-disabled)]">上下文方式</div>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => updateStrategy('fixed_window')} className={`${SELECT} ${draft.strategy === 'fixed_window' ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]' : ''}`}>原换窗机制</button>
        <button type="button" onClick={() => updateStrategy('daily_rolling')} className={`${SELECT} ${draft.strategy === 'daily_rolling' ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]' : ''}`}>按天滚动</button>
      </div>

      {draft.strategy === 'daily_rolling' ? (
        <>
          <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] p-2.5 text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">
            这里只决定模型下一轮能看到什么，不删除聊天记录。原文日里的已召回记忆不会重复召回；改成日回顾或不带后，以后可以再次召回。
          </div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label className="text-[11px] text-[var(--color-text-tertiary)]">一天从北京时间</label>
            <select className={SELECT} value={draft.day_start_hour} onChange={event => setDraft({ ...draft, day_start_hour: Number(event.target.value) })}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </div>
          <div className="mb-2 flex justify-between text-[10.5px] text-[var(--color-text-disabled)]">
            <span>日期内容</span><span>约 {estimatedChars.toLocaleString()} 字</span>
          </div>
          <div className="space-y-1.5">
            {[...days].sort((a, b) => b.day.localeCompare(a.day)).map(day => {
              const mode = draft.day_modes?.[day.day] || 'raw'
              return (
                <div key={day.day} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] text-[var(--color-text-secondary)]">{day.day}</div>
                    <div className="text-[9.5px] text-[var(--color-text-disabled)]">{day.turn_count} 轮 · 原文 {day.raw_chars.toLocaleString()} 字{day.review ? ` · 回顾 ${day.review.chars.toLocaleString()} 字` : ' · 暂无日回顾'}</div>
                  </div>
                  <select
                    className={SELECT}
                    value={mode}
                    onChange={event => setDraft({ ...draft, day_modes: { ...draft.day_modes, [day.day]: event.target.value as 'raw' | 'review' | 'omit' } })}
                  >
                    <option value="raw">原文</option>
                    <option value="review" disabled={!day.review}>日回顾</option>
                    <option value="omit">不带</option>
                  </select>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="text-[10.5px] leading-relaxed text-[var(--color-text-disabled)]">继续使用当前的冻结换窗资料和原生会话续接，不改变现有行为。</div>
      )}

      <button type="button" disabled={saving || busy} onClick={() => void save()} className="mt-4 w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-2 text-[11.5px] text-white disabled:opacity-50">
        {saving ? '保存中…' : busy ? '回复结束后可保存' : '保存上下文拼接'}
      </button>
      {note ? <div className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">{note}</div> : null}
    </div>
  )
}
