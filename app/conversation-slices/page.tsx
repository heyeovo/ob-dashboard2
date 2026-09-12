'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Card from '../components/Card'

type Persona = { id: string; name?: string }
type Session = { session_id: string; title?: string; pinned_at?: string | null; turn_count?: number }
type SliceDay = {
  chat_day: string
  slice_count: number
  unreviewed_count: number
  issue_count: number
  prompt_versions: string[]
  task_statuses: string[]
}
type SliceTask = {
  task_id: string
  session_id: string
  chat_day: string
  trigger_type: string
  status: string
  message_count: number
  estimated_input_tokens: number
  estimated_call_count: number
  error_detail?: string
}
type SliceItem = {
  slice_id: string
  sequence_no: number
  summary: string
  source_message_ids: string[]
  source_time_start: string
  source_time_end: string
  event_time_start?: string | null
  event_time_end?: string | null
  boundary_reason: string
  lifecycle_status: string
  review_status: string
  review_reason?: string
  review_note?: string
}
type SliceSession = {
  session_id: string
  session_title: string
  batch_id: string
  source_message_count: number
  segmenter_version: string
  slice_prompt_version: string
  slice_schema_version: string
  generator_model: string
  reslice_revision: number
  coverage: { ignored_ranges?: Array<{ message_ids?: string[]; reason?: string }>; zero_slice_reason?: string }
  slices: SliceItem[]
}
type DayDetail = { chat_day: string; sessions: SliceSession[]; tasks: SliceTask[] }
type SourceMessage = { message_id: string; role: string; content: string; created_at: string }
type Estimate = {
  start_date: string
  end_date: string
  message_count: number
  estimated_input_tokens: number
  estimated_call_count: number
  estimate_signature: string
}

const REASONS = [
  ['fabricated', '编造'], ['stiff', '太僵硬'], ['emotion', '情绪不准'],
  ['missing', '遗漏重点'], ['boundary', '切分错误'], ['duplicate', '重复'], ['other', '其他'],
] as const

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(String(data.error || `请求失败（${response.status}）`))
  return data
}

export default function ConversationSlicesPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [personaId, setPersonaId] = useState('ombre')
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionId, setSessionId] = useState('')
  const [days, setDays] = useState<SliceDay[]>([])
  const [tasks, setTasks] = useState<SliceTask[]>([])
  const [selectedDay, setSelectedDay] = useState('')
  const [detail, setDetail] = useState<DayDetail | null>(null)
  const [sourceBySlice, setSourceBySlice] = useState<Record<string, SourceMessage[]>>({})
  const [reasonBySlice, setReasonBySlice] = useState<Record<string, string>>({})
  const [noteBySlice, setNoteBySlice] = useState<Record<string, string>>({})
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    jsonRequest('/api/cc-personas').then(data => {
      const items = Array.isArray(data.personas) ? data.personas : []
      setPersonas(items)
      if (items.length && !items.some((item: Persona) => item.id === personaId)) setPersonaId(items[0].id)
    }).catch(reason => setError(String(reason)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadOverview = useCallback(async (nextPersona: string) => {
    setError('')
    const [sessionData, sliceData] = await Promise.all([
      jsonRequest(`/api/cc-turns?persona_id=${encodeURIComponent(nextPersona)}&limit=200`),
      jsonRequest(`/api/conversation-slices?persona_id=${encodeURIComponent(nextPersona)}&limit=366`),
    ])
    const nextSessions = Array.isArray(sessionData.sessions) ? sessionData.sessions : []
    const nextDays = Array.isArray(sliceData.days) ? sliceData.days : []
    setSessions(nextSessions)
    setTasks(Array.isArray(sliceData.tasks) ? sliceData.tasks : [])
    setDays(nextDays)
    setSessionId(current => nextSessions.some((item: Session) => item.session_id === current)
      ? current
      : String(nextSessions.find((item: Session) => item.pinned_at)?.session_id || nextSessions[0]?.session_id || ''))
    setSelectedDay(current => nextDays.some((item: SliceDay) => item.chat_day === current) ? current : '')
  }, [])

  useEffect(() => {
    loadOverview(personaId).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [personaId, loadOverview])

  const loadDay = useCallback(async (day: string) => {
    if (!day) { setDetail(null); return }
    const data = await jsonRequest(`/api/conversation-slices?persona_id=${encodeURIComponent(personaId)}&chat_day=${encodeURIComponent(day)}`)
    setDetail(data.day || null)
  }, [personaId])

  useEffect(() => {
    loadDay(selectedDay).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [selectedDay, loadDay])

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setError(''); setNotice('')
    try {
      return await jsonRequest('/api/conversation-slices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } finally { setBusy('') }
  }

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setError(''); setNotice('')
    try {
      return await jsonRequest('/api/conversation-slices', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } finally { setBusy('') }
  }

  const refresh = async () => {
    await loadOverview(personaId)
    if (selectedDay) await loadDay(selectedDay)
  }

  const generateDate = async () => {
    if (!sessionId || !selectedDay) return
    try {
      const data = await post({ action: 'generate_date', persona_id: personaId, session_id: sessionId, chat_day: selectedDay }, 'generate')
      setNotice(data.status === 'completed' ? '切片已生成，可以开始检查。' : '任务已完成处理，请查看状态。')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const estimateBackfill = async () => {
    if (!sessionId || !startDate || !endDate) return
    try {
      const data = await post({ action: 'estimate_backfill', persona_id: personaId, session_id: sessionId, start_date: startDate, end_date: endDate }, 'estimate')
      setEstimate(data.estimate)
      setNotice('仅完成估算，尚未创建或执行历史任务。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const createBackfill = async () => {
    if (!estimate) return
    try {
      const data = await post({
        action: 'create_backfill', persona_id: personaId, session_id: sessionId,
        start_date: estimate.start_date, end_date: estimate.end_date,
        estimate_signature: estimate.estimate_signature,
      }, 'create-backfill')
      setNotice(`已创建 ${Number(data.created || 0)} 个暂停/继续可控的任务；尚未自动执行。`)
      setEstimate(null)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const review = async (slice: SliceItem, reviewStatus: 'approved' | 'rejected') => {
    const reason = reasonBySlice[slice.slice_id] || ''
    if (reviewStatus === 'rejected' && !reason) { setError('标记有问题前，请先选择问题原因。'); return }
    try {
      await patch({
        action: 'review', slice_id: slice.slice_id, review_status: reviewStatus,
        review_reason: reason, review_note: noteBySlice[slice.slice_id] || '',
      }, `review-${slice.slice_id}`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const loadSource = async (sliceId: string) => {
    if (sourceBySlice[sliceId]) { setSourceBySlice(current => { const next = { ...current }; delete next[sliceId]; return next }); return }
    setBusy(`source-${sliceId}`)
    try {
      const data = await jsonRequest(`/api/conversation-slices?persona_id=${encodeURIComponent(personaId)}&slice_id=${encodeURIComponent(sliceId)}`)
      setSourceBySlice(current => ({ ...current, [sliceId]: data.source?.messages || [] }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy('') }
  }

  const reslice = async (group: SliceSession) => {
    try {
      await post({
        action: 'reslice', persona_id: personaId, session_id: group.session_id,
        chat_day: selectedDay, expected_revision: group.reslice_revision,
      }, `reslice-${group.session_id}`)
      setNotice('重新生成成功；旧批次已在新批次通过校验后替换。')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const operateTask = async (task: SliceTask, action: 'pause' | 'resume' | 'retry' | 'run_task') => {
    try {
      if (action === 'run_task') await post({ action, task_id: task.task_id }, `task-${task.task_id}`)
      else await patch({ action, task_id: task.task_id }, `task-${task.task_id}`)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const selectedSession = useMemo(() => sessions.find(item => item.session_id === sessionId), [sessions, sessionId])
  const showMobileDetail = Boolean(selectedDay)

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-[var(--color-bg)] px-4 pb-24 pt-5 text-[var(--color-text-primary)] sm:px-6 sm:pt-8">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-heading)] sm:text-3xl">聊天切片检查</h1>
          <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">离线生成与人工检查；这里的切片不会进入正式聊天 Context。</p>
        </div>
        <select value={personaId} onChange={event => setPersonaId(event.target.value)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          {personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name || persona.id}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-[var(--color-digested-border)] bg-[var(--color-digested-bg)] px-3 py-2 text-sm text-[var(--color-digested)]">{notice}</div>}

      <Card className="mb-5" padding="lg">
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h2 className="font-semibold text-[var(--color-text-heading)]">少量日期试生成</h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">选择一个真实窗口和日期，执行 slice-only；不会改写已有日回顾。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <select value={sessionId} onChange={event => { setSessionId(event.target.value); setEstimate(null) }} className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                {sessions.map(session => <option key={session.session_id} value={session.session_id}>{session.pinned_at ? '★ ' : ''}{session.title || session.session_id}</option>)}
              </select>
              <input type="date" value={selectedDay} onChange={event => setSelectedDay(event.target.value)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
              <button disabled={!sessionId || !selectedDay || Boolean(busy)} onClick={generateDate} className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === 'generate' ? '生成中…' : '生成并检查'}</button>
            </div>
          </section>
          <section>
            <h2 className="font-semibold text-[var(--color-text-heading)]">历史回填预估</h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">先展示消息量、输入 token 和调用次数；创建后仍需逐项执行。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input type="date" value={startDate} onChange={event => { setStartDate(event.target.value); setEstimate(null) }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
              <input type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setEstimate(null) }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
              <button disabled={!sessionId || !startDate || !endDate || Boolean(busy)} onClick={estimateBackfill} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm disabled:opacity-50">先估算</button>
            </div>
            {estimate && <div className="mt-3 rounded-lg bg-[var(--color-primary-muted)] p-3 text-sm">
              <div>{estimate.message_count.toLocaleString()} 条消息 · 约 {estimate.estimated_input_tokens.toLocaleString()} 输入 token · {estimate.estimated_call_count.toLocaleString()} 次调用</div>
              <button onClick={createBackfill} disabled={Boolean(busy)} className="mt-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50">确认创建任务（不自动执行）</button>
            </div>}
          </section>
        </div>
        {selectedSession && <div className="mt-3 text-xs text-[var(--color-text-disabled)]">当前窗口：{selectedSession.title || selectedSession.session_id}</div>}
      </Card>

      <div className="grid gap-5 md:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className={showMobileDetail ? 'hidden md:block' : 'block'}>
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-heading)]">日期</h2>
          <div className="space-y-2">
            {days.map(day => <button key={day.chat_day} onClick={() => setSelectedDay(day.chat_day)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedDay === day.chat_day ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}`}>
              <div className="flex items-center justify-between"><span className="font-medium">{day.chat_day}</span><span className="text-xs text-[var(--color-text-tertiary)]">{day.slice_count} 条</span></div>
              <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">未检查 {day.unreviewed_count}{day.issue_count ? ` · 异常 ${day.issue_count}` : ''}{day.task_statuses.length ? ` · ${day.task_statuses.join('/')}` : ''}</div>
            </button>)}
            {!days.length && <Card variant="empty"><p className="text-sm text-[var(--color-text-tertiary)]">还没有聊天日期。</p></Card>}
          </div>
        </aside>

        <section className={!showMobileDetail ? 'hidden md:block' : 'block'}>
          <button onClick={() => setSelectedDay('')} className="mb-3 text-sm text-[var(--color-primary)] md:hidden">← 返回日期列表</button>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-[var(--color-text-heading)]">{selectedDay || '选择日期'}</h2></div>
          <div className="space-y-4">
            {detail?.sessions.map(group => <Card key={group.batch_id} padding="lg">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-semibold text-[var(--color-text-heading)]">{group.session_title || group.session_id}</h3><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{group.source_message_count} 条原始消息 · revision {group.reslice_revision} · {group.slice_prompt_version}</p></div>
                <button onClick={() => reslice(group)} disabled={Boolean(busy)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50">重新生成</button>
              </div>
              <div className="mt-4 space-y-3">
                {group.slices.map(slice => <div key={slice.slice_id} className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-tertiary)]"><span>#{slice.sequence_no} · {slice.boundary_reason}</span><span>{slice.review_status}</span></div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{slice.summary}</p>
                  <p className="mt-2 text-xs text-[var(--color-text-disabled)]">{slice.source_message_ids[0]} → {slice.source_message_ids.at(-1)} · {slice.source_time_start}</p>
                  <button onClick={() => loadSource(slice.slice_id)} className="mt-2 text-xs text-[var(--color-primary)]">{sourceBySlice[slice.slice_id] ? '收起原文' : busy === `source-${slice.slice_id}` ? '读取中…' : '按永久消息 ID 查看原文'}</button>
                  {sourceBySlice[slice.slice_id] && <div className="mt-2 space-y-2 rounded-lg bg-[var(--color-surface)] p-3">{sourceBySlice[slice.slice_id].map(message => <div key={message.message_id}><div className="text-[11px] text-[var(--color-text-disabled)]">{message.role} · {message.message_id}</div><div className="mt-0.5 whitespace-pre-wrap text-xs leading-5">{message.content}</div></div>)}</div>}
                  <div className="mt-3 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                    <select value={reasonBySlice[slice.slice_id] || ''} onChange={event => setReasonBySlice(current => ({ ...current, [slice.slice_id]: event.target.value }))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"><option value="">问题原因</option>{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <input value={noteBySlice[slice.slice_id] || ''} onChange={event => setNoteBySlice(current => ({ ...current, [slice.slice_id]: event.target.value }))} placeholder="备注（可选）" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs" />
                    <button onClick={() => review(slice, 'approved')} disabled={Boolean(busy)} className="rounded-lg bg-[var(--color-digested-bg)] px-3 py-1.5 text-xs text-[var(--color-digested)] disabled:opacity-50">正确</button>
                    <button onClick={() => review(slice, 'rejected')} disabled={Boolean(busy)} className="rounded-lg bg-[var(--color-danger-bg)] px-3 py-1.5 text-xs text-[var(--color-danger)] disabled:opacity-50">有问题</button>
                  </div>
                </div>)}
                {!group.slices.length && <div className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-tertiary)]">0 条切片：{group.coverage.zero_slice_reason || '全部消息均已明确忽略'}</div>}
                {!!group.coverage.ignored_ranges?.length && <details className="text-xs text-[var(--color-text-tertiary)]"><summary className="cursor-pointer">查看被忽略的原文范围</summary><div className="mt-2 space-y-1">{group.coverage.ignored_ranges.map((range, index) => <div key={index}>{range.message_ids?.join(' → ')} · {range.reason}</div>)}</div></details>}
              </div>
            </Card>)}
            {selectedDay && detail && !detail.sessions.length && <Card variant="empty"><p className="text-sm text-[var(--color-text-tertiary)]">这一天还没有有效切片。可在上方选择窗口后执行少量试生成。</p></Card>}
          </div>
        </section>
      </div>

      {!!tasks.length && <Card className="mt-5" padding="lg"><h2 className="font-semibold text-[var(--color-text-heading)]">离线任务</h2><div className="mt-3 space-y-2">{tasks.slice(0, 30).map(task => <div key={task.task_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-secondary)] p-3 text-xs"><div><div className="font-medium">{task.chat_day} · {sessions.find(item => item.session_id === task.session_id)?.title || task.session_id}</div><div className="mt-1 text-[var(--color-text-tertiary)]">{task.trigger_type} · {task.status} · {task.message_count} 条 · 约 {task.estimated_input_tokens.toLocaleString()} token</div>{task.error_detail && <div className="mt-1 text-[var(--color-danger)]">{task.error_detail}</div>}</div><div className="flex gap-1">{task.status === 'queued' && <><button onClick={() => operateTask(task, 'pause')} className="rounded-md border border-[var(--color-border)] px-2 py-1">暂停</button><button onClick={() => operateTask(task, 'run_task')} className="rounded-md bg-[var(--color-primary)] px-2 py-1 text-white">执行</button></>}{task.status === 'paused' && <button onClick={() => operateTask(task, 'resume')} className="rounded-md border border-[var(--color-border)] px-2 py-1">继续</button>}{task.status === 'failed' && <button onClick={() => operateTask(task, 'retry')} className="rounded-md border border-[var(--color-danger-border)] px-2 py-1 text-[var(--color-danger)]">失败重试</button>}</div></div>)}</div></Card>}
    </main>
  )
}
