'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type NumberMap = Record<string, number | null | undefined>

interface PersonaState {
  affect?: NumberMap & {
    mood_label?: never
    inner_thought?: never
    residue?: never
  }
  relationship?: NumberMap
  personality?: NumberMap
}

interface PersonaSession {
  session_id?: string
  title?: string
  mood_label?: string
  updated_at?: string
}

interface PersonaEvent {
  event_type?: string
  inner_thought?: string
  residue?: string
  perceived_intent?: string
  surface_trigger?: string
  error?: string
  mood_label?: string
  confidence?: number
  message_hash?: string
  created_at?: string
  affect_delta?: NumberMap
  relationship_delta?: NumberMap
  personality_delta?: NumberMap
}

interface PersonaPayload {
  state?: PersonaState & {
    affect?: NumberMap & {
      mood_label?: never
      inner_thought?: never
      residue?: never
    }
  }
  config?: {
    enabled?: boolean
    event_recording_enabled?: boolean
    api_ready?: boolean
    model?: string
  }
  sessions?: PersonaSession[]
  events?: PersonaEvent[]
  active_session_id?: string
}

type DateRange = 'today' | '7d' | 'all'

const AFFECT_FIELDS = [
  ['valence', '情绪效价'],
  ['arousal', '唤醒度'],
  ['tenderness', '温柔'],
  ['possessiveness', '占有'],
  ['longing', '想念'],
  ['security', '安全感'],
  ['protective_drive', '保护倾向'],
] as const

const RELATIONSHIP_FIELDS = [
  ['affinity', '亲和'],
  ['dominance', '主导'],
  ['defensiveness', '防御'],
  ['trust', '信任'],
] as const

const PERSONALITY_FIELDS = [
  ['openness', '开放'],
  ['conscientiousness', '自律'],
  ['extraversion', '外向'],
  ['agreeableness', '温和'],
  ['neuroticism', '敏感'],
] as const

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...AFFECT_FIELDS, ...RELATIONSHIP_FIELDS, ...PERSONALITY_FIELDS],
)

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bounded(value: unknown): number {
  return Math.max(0, Math.min(1, numeric(value)))
}

function dateKey(value?: string): string {
  if (!value) return '日期未知'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).format(parsed)
}

function formatTime(value?: string): string {
  if (!value) return '时间未知'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(parsed)
}

function isWithinRange(value: string | undefined, range: DateRange): boolean {
  if (range === 'all') return true
  if (!value) return false
  const created = new Date(value)
  if (Number.isNaN(created.getTime())) return false
  const now = new Date()
  if (range === 'today') return created.toDateString() === now.toDateString()
  return created.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000
}

function Metric({ label, value }: { label: string; value: unknown }) {
  const amount = bounded(value)
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_38px] items-center gap-3 text-xs sm:grid-cols-[104px_minmax(0,1fr)_42px]">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-tertiary)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#D7A9A0] via-[var(--color-primary)] to-[#8DA8A3] transition-[width] duration-500"
          style={{ width: `${Math.round(amount * 100)}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-[var(--color-text-tertiary)]">{Math.round(amount * 100)}</span>
    </div>
  )
}

function MetricCard({ title, pace, fields, values }: {
  title: string
  pace: string
  fields: readonly (readonly [string, string])[]
  values: NumberMap
}) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-[var(--color-text-heading)]">{title}</h2>
        <span className="text-[11px] text-[var(--color-text-disabled)]">{pace}</span>
      </div>
      <div className="space-y-3.5">
        {fields.map(([key, label]) => <Metric key={key} label={label} value={values[key]} />)}
      </div>
    </section>
  )
}

function StatusPill({ label, ok, paused }: { label: string; ok: boolean; paused?: boolean }) {
  const tone = ok
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : paused
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-rose-200 bg-rose-50 text-rose-700'
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] ${tone}`}>{label}</span>
}

function DeltaList({ event }: { event: PersonaEvent }) {
  const groups: Array<[string, NumberMap]> = [
    ['情绪', event.affect_delta || {}],
    ['关系', event.relationship_delta || {}],
    ['人格', event.personality_delta || {}],
  ]
  const deltas = groups.flatMap(([group, values]) => Object.entries(values)
    .map(([key, value]) => ({ group, key, value: numeric(value) }))
    .filter(item => Math.abs(item.value) >= 0.0001))

  if (deltas.length === 0) {
    return <p className="mt-3 text-xs text-[var(--color-text-disabled)]">本次评估没有记录到数值变化</p>
  }

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {deltas.map(({ group, key, value }) => (
        <span
          key={`${group}-${key}`}
          className={`rounded-full px-2 py-1 text-[11px] tabular-nums ${value > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
          title={`${group}.${key}`}
        >
          {group}·{FIELD_LABELS[key] || key} {value > 0 ? '+' : ''}{value.toFixed(3)}
        </span>
      ))}
    </div>
  )
}

function PersonaStateView() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'state'
  const [payload, setPayload] = useState<PersonaPayload | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [range, setRange] = useState<DateRange>('7d')
  const [copiedSessionId, setCopiedSessionId] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadPersona = useCallback(async (selectedSession = '', signal?: AbortSignal) => {
    const params = new URLSearchParams({ events_limit: '100', sessions_limit: '30' })
    if (selectedSession) params.set('session_id', selectedSession)
    const response = await fetch(`/api/persona?${params}`, { signal, cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.error) throw new Error(data.error || `读取 Persona 状态失败（${response.status}）`)
    setPayload(data)
    setSessionId(data.active_session_id || selectedSession || '')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve()
      .then(() => loadPersona('', controller.signal))
      .catch(reason => {
        if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取 Persona 状态失败')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [loadPersona])

  const state = payload?.state || {}
  const affectRaw = asRecord(state.affect)
  const affect = affectRaw as NumberMap
  const relationship = (state.relationship || {}) as NumberMap
  const personality = (state.personality || {}) as NumberMap
  const mood = textValue(affectRaw.mood_label) || 'warm_neutral'
  const residue = textValue(affectRaw.inner_thought) || textValue(affectRaw.residue) || '当前没有明显余味。'
  const arousal = bounded(affect.arousal)
  const valence = bounded(affect.valence)
  const warmth = Math.round(12 + valence * 20)
  const cfg = payload?.config || {}
  const sessions = payload?.sessions || []
  const events = useMemo(() => payload?.events || [], [payload?.events])
  const activeSession = sessions.find(session => session.session_id === sessionId)

  const groupedEvents = useMemo(() => {
    const filtered = events.filter(event => isWithinRange(event.created_at, range))
    return filtered.reduce<Array<{ date: string; items: PersonaEvent[] }>>((groups, event) => {
      const key = dateKey(event.created_at)
      const current = groups.at(-1)
      if (current?.date === key) current.items.push(event)
      else groups.push({ date: key, items: [event] })
      return groups
    }, [])
  }, [events, range])

  if (tab !== 'state') {
    return (
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white p-10 text-center">
          <h1 className="text-lg font-semibold">画像将在窗口 8 迁移</h1>
          <p className="mt-2 text-sm text-[var(--color-text-tertiary)]">本窗口只实施 Persona 状态。</p>
          <Link href="/persona?tab=state" className="mt-5 inline-flex rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm text-white">返回内在状态</Link>
        </div>
      </main>
    )
  }

  return (
    <>
      <style>{`
        @keyframes persona-breathe { 0%,100% { transform: scale(.96); } 50% { transform: scale(1.04); } }
        .persona-orb-motion { animation: persona-breathe var(--persona-speed) ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .persona-orb-motion { animation: none; } }
      `}</style>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-tertiary)] hover:bg-black/5">← Home</Link>
            <div>
              <h1 className="text-base font-semibold">Persona 中心</h1>
              <p className="hidden text-xs text-[var(--color-text-disabled)] sm:block">内在状态由 Haven 管理</p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setError('')
              setLoading(true)
              loadPersona(sessionId).catch(reason => setError(reason instanceof Error ? reason.message : '刷新失败')).finally(() => setLoading(false))
            }}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] disabled:opacity-50"
          >
            {loading ? '读取中…' : '刷新'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 lg:py-8">
        <nav className="mb-5 flex gap-1 rounded-xl bg-[var(--color-surface-secondary)] p-1 text-sm">
          <Link href="/persona?tab=state" className="rounded-lg bg-white px-4 py-2 font-medium text-[var(--color-text-heading)] shadow-sm">内在状态</Link>
          <span className="cursor-not-allowed rounded-lg px-4 py-2 text-[var(--color-text-disabled)]" title="窗口 8">画像 · 待迁移</span>
        </nav>

        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-text-heading)]">当前内在状态</h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">情绪按 session 回落，关系中速变化，人格缓慢变化</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            session
            <select
              value={sessionId}
              disabled={loading}
              onChange={event => {
                const next = event.target.value
                setError('')
                setCopiedSessionId(false)
                setSessionId(next)
                setLoading(true)
                loadPersona(next).catch(reason => setError(reason instanceof Error ? reason.message : '切换 session 失败')).finally(() => setLoading(false))
              }}
              className="max-w-[260px] rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              {sessionId && !sessions.some(session => session.session_id === sessionId) && <option value={sessionId}>{sessionId}</option>}
              {sessions.map(session => (
                <option key={session.session_id} value={session.session_id}>
                  {session.title || session.session_id}{session.mood_label ? ` · ${session.mood_label}` : ''}{session.updated_at ? ` · ${formatTime(session.updated_at)}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {!payload && loading ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white px-4 py-16 text-center text-sm text-[var(--color-text-disabled)]">正在从 Haven 读取 Persona 状态…</div>
        ) : payload && (
          <>
            <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(280px,.82fr)_minmax(0,1.18fr)]">
              <section className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
                <div
                  className="persona-orb-motion mx-auto h-40 w-40 rounded-full sm:h-44 sm:w-44"
                  style={{
                    '--persona-speed': `${6.5 - arousal * 3.5}s`,
                    opacity: 0.76 + arousal * 0.24,
                    background: `radial-gradient(circle at 36% 30%, rgba(255,255,255,.94), rgba(255,255,255,.16) 28%, transparent 41%), radial-gradient(circle at 55% 56%, hsl(${warmth} 42% 64%), hsl(${155 - valence * 38} 22% 48%) 62%, hsl(355 30% 63%) 100%)`,
                    boxShadow: '18px 18px 34px rgba(139,116,102,.18), -14px -14px 30px rgba(255,255,255,.86), inset 14px 14px 28px rgba(255,255,255,.30), inset -16px -16px 28px rgba(59,84,78,.22)',
                  } as React.CSSProperties}
                  role="img"
                  aria-label={`当前心情 ${mood}，唤醒度 ${Math.round(arousal * 100)}`}
                />
                <div className="mt-6 text-center">
                  <p className="text-xs text-[var(--color-text-disabled)]">当前心情</p>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--color-text-heading)]">{mood}</h2>
                  <p className="mt-1 text-xs tabular-nums text-[var(--color-text-tertiary)]">V {numeric(affect.valence).toFixed(2)} · A {numeric(affect.arousal).toFixed(2)}</p>
                </div>
                <div className="mt-6 rounded-2xl bg-[var(--color-surface-secondary)] p-4">
                  <p className="text-[11px] font-medium text-[var(--color-text-disabled)]">内在余味</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">{residue}</p>
                </div>
                {activeSession?.title && (
                  <p className="mt-4 truncate text-center text-xs font-medium text-[var(--color-text-tertiary)]" title={activeSession.title}>{activeSession.title}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-[var(--color-text-disabled)]">
                  {activeSession?.updated_at && <span>更新于 {formatTime(activeSession.updated_at)}</span>}
                  <code className="max-w-full truncate rounded bg-[var(--color-surface-secondary)] px-2 py-1" title={sessionId || '未指定'}>Session ID: {sessionId || '未指定'}</code>
                  {sessionId && (
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(sessionId)
                        setCopiedSessionId(true)
                      }}
                      className="rounded px-2 py-1 text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]"
                    >
                      {copiedSessionId ? '已复制' : '复制'}
                    </button>
                  )}
                </div>
              </section>

              <div className="grid gap-5 sm:grid-cols-2">
                <MetricCard title="Affect" pace="快变 · session" fields={AFFECT_FIELDS} values={affect} />
                <MetricCard title="Relationship" pace="中速变化" fields={RELATIONSHIP_FIELDS} values={relationship} />
                <div className="sm:col-span-2">
                  <MetricCard title="Personality" pace="慢变" fields={PERSONALITY_FIELDS} values={personality} />
                </div>
              </div>
            </div>

            <section className="mb-5 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-[var(--color-text-heading)]">运行状态</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-disabled)]">这些是 Haven Persona 引擎的健康信息，不是“协作者”配置</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill label={cfg.enabled === false ? '引擎已暂停' : '引擎运行中'} ok={cfg.enabled !== false} paused={cfg.enabled === false} />
                  <StatusPill label={cfg.event_recording_enabled === false ? '事件记录已暂停' : '事件记录中'} ok={cfg.event_recording_enabled !== false} paused={cfg.event_recording_enabled === false} />
                  <StatusPill label={cfg.api_ready ? 'API 已就绪' : 'API 未就绪 · fallback'} ok={Boolean(cfg.api_ready)} />
                  <StatusPill label={cfg.model || '模型未设置'} ok={Boolean(cfg.model)} />
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-[var(--color-border-light)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <h2 className="font-semibold text-[var(--color-text-heading)]">Recent Persona Events</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-disabled)]">按日期查看每轮评估及其 delta</p>
                </div>
                <div className="flex rounded-lg bg-[var(--color-surface-secondary)] p-1 text-xs">
                  {([['today', '今天'], ['7d', '近 7 天'], ['all', '全部']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRange(value)}
                      className={`rounded-md px-3 py-1.5 ${range === value ? 'bg-white font-medium text-[var(--color-text-heading)] shadow-sm' : 'text-[var(--color-text-tertiary)]'}`}
                    >{label}</button>
                  ))}
                </div>
              </div>

              {groupedEvents.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-[var(--color-text-disabled)]">
                  {cfg.event_recording_enabled === false ? '事件记录已关闭，状态仍可继续更新。' : '这个时间范围内还没有 Persona 事件。'}
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border-light)]">
                  {groupedEvents.map(group => (
                    <div key={group.date} className="px-4 py-5 sm:px-5">
                      <h3 className="mb-3 text-xs font-semibold text-[var(--color-text-tertiary)]">{group.date}</h3>
                      <div className="space-y-3">
                        {group.items.map((event, index) => {
                          const thought = event.inner_thought || event.residue || event.perceived_intent || event.error || '没有记录内在描述'
                          const trigger = event.surface_trigger || event.perceived_intent || ''
                          return (
                            <article key={`${event.created_at || index}-${event.message_hash || index}`} className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">{event.event_type || 'unknown'}</span>
                                <time className="text-[11px] text-[var(--color-text-disabled)]">{formatTime(event.created_at)}</time>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">{thought}</p>
                              {trigger && trigger !== thought && <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{trigger}</p>}
                              <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-[var(--color-text-disabled)]">
                                <span>{event.mood_label || '心情未设置'}</span>
                                <span>confidence {numeric(event.confidence).toFixed(2)}</span>
                                {event.message_hash && <span>#{event.message_hash}</span>}
                              </div>
                              <DeltaList event={event} />
                            </article>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  )
}

export default function PersonaPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <Suspense fallback={<div className="px-4 py-16 text-center text-sm text-[var(--color-text-disabled)]">加载 Persona 中心…</div>}>
        <PersonaStateView />
      </Suspense>
    </div>
  )
}
