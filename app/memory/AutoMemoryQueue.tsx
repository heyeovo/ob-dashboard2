'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface AutoMemoryCandidate {
  id: string
  date?: string
  kind?: string
  title?: string
  content?: string
  domain?: string[]
  tags?: string[]
  importance?: number
  confidence?: number
}

interface PendingItem {
  id: string
  date?: string
  created_at?: string
  candidate: AutoMemoryCandidate
}

interface CandidateDraft {
  title: string
  content: string
  kind: string
  domain: string
  tags: string
  importance: number
  confidence: number
}

const KIND_OPTIONS = [
  ['key_event', '关键事件'],
  ['stable_preference', '稳定偏好'],
  ['boundary', '边界'],
  ['signal', '暗号 / 信号'],
  ['commitment', '约定'],
  ['project_state', '项目状态'],
  ['relationship_anchor', '关系锚点'],
] as const

const KIND_LABELS = Object.fromEntries(KIND_OPTIONS)

function toDraft(candidate: AutoMemoryCandidate): CandidateDraft {
  return {
    title: candidate.title ?? '',
    content: candidate.content ?? '',
    kind: candidate.kind ?? 'key_event',
    domain: (candidate.domain ?? []).join(', '),
    tags: (candidate.tags ?? []).join(', '),
    importance: candidate.importance ?? 5,
    confidence: candidate.confidence ?? 0.7,
  }
}

async function responseError(res: Response) {
  const raw = await res.text()
  if (!raw) return `请求失败（HTTP ${res.status}）`
  try {
    const data = JSON.parse(raw)
    return data.error || data.message || raw
  } catch {
    return raw
  }
}

function formatCandidateDate(value?: string) {
  if (!value) return '日期未知'
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AutoMemoryQueue({ onRefresh }: { onRefresh: () => void }) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [current, setCurrent] = useState(0)
  const [draft, setDraft] = useState<CandidateDraft | null>(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [operating, setOperating] = useState<'confirm' | 'reject' | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/daily-chat-memory?_t=${Date.now()}`, {
        cache: 'no-store',
        signal,
      })
      if (!res.ok) throw new Error(await responseError(res))
      const data = await res.json()
      const nextItems = Array.isArray(data.items) ? data.items : []
      setItems(nextItems)
      setCurrent(0)
      setDraft(nextItems[0]?.candidate ? toDraft(nextItems[0].candidate) : null)
      setEditing(false)
    } catch (loadError) {
      if ((loadError as Error)?.name !== 'AbortError') {
        setError((loadError as Error)?.message || '自动记忆候选加载失败')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const initialLoad = window.setTimeout(() => loadItems(controller.signal), 0)
    return () => {
      window.clearTimeout(initialLoad)
      controller.abort()
    }
  }, [loadItems])

  const item = items[current]
  const candidate = item?.candidate

  const selectItem = (index: number) => {
    const nextIndex = Math.max(0, Math.min(items.length - 1, index))
    setCurrent(nextIndex)
    setDraft(items[nextIndex]?.candidate ? toDraft(items[nextIndex].candidate) : null)
    setEditing(false)
    setError('')
    setSuccess('')
  }

  const visibleTags = useMemo(
    () => (candidate?.tags ?? []).filter(tag => !['from_daily_chat', 'daily_chat_extract'].includes(tag)),
    [candidate?.tags],
  )

  const completeAction = async (action: 'confirm' | 'reject') => {
    if (!item || !draft) return
    if (action === 'reject' && !window.confirm('拒绝这条自动记忆候选？拒绝后不会写入记忆库。')) return
    if (action === 'confirm' && (!draft.title.trim() || !draft.content.trim())) {
      setError('标题和正文不能为空。')
      return
    }

    setOperating(action)
    setError('')
    setSuccess('')
    try {
      const body = action === 'reject'
        ? { action: 'reject', confirm: 'REJECT', candidate_ids: [item.id] }
        : {
            action: 'confirm',
            confirm: 'WRITE',
            candidate_ids: [item.id],
            edits: {
              [item.id]: {
                title: draft.title.trim(),
                content: draft.content.trim(),
                kind: draft.kind,
                domain: draft.domain,
                tags: draft.tags,
                importance: draft.importance,
                confidence: draft.confidence,
              },
            },
          }
      const res = await fetch('/api/daily-chat-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await responseError(res))
      const data = await res.json()
      if (data.status !== 'ok') throw new Error(data.reason || 'Haven 未完成本次操作')
      if (action === 'confirm' && !data.results?.some((result: { status?: string }) => ['created', 'exists'].includes(result.status ?? ''))) {
        const failed = data.results?.find((result: { status?: string }) => result.status === 'failed')
        throw new Error(failed?.reason || (data.missing ? '候选已不存在，请刷新后重试。' : '长期记忆写入失败。'))
      }
      if (action === 'reject' && Number(data.rejected) < 1) {
        throw new Error(data.missing ? '候选已不存在，请刷新后重试。' : 'Haven 未拒绝这条候选。')
      }

      const nextItems = items.filter(pending => pending.id !== item.id)
      const nextIndex = Math.min(current, Math.max(0, nextItems.length - 1))
      setItems(nextItems)
      setCurrent(nextIndex)
      setDraft(nextItems[nextIndex]?.candidate ? toDraft(nextItems[nextIndex].candidate) : null)
      setEditing(false)
      setSuccess(action === 'confirm' ? '已写入长期记忆。' : '已拒绝候选。')
      onRefresh()
    } catch (actionError) {
      setError((actionError as Error)?.message || '操作失败')
    } finally {
      setOperating(null)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-sm text-[var(--color-text-tertiary)]">自动记忆候选加载中…</div>
  }

  if (error && !item) {
    return (
      <div className="rounded-2xl border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-5 text-sm text-[var(--color-danger)]">
        <p>{error}</p>
        <button onClick={() => loadItems()} className="mt-3 rounded-lg border border-[var(--color-danger-border)] bg-white px-3 py-1.5 font-medium">重试</button>
      </div>
    )
  }

  if (!item || !candidate || !draft) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white py-20 text-center text-sm text-[var(--color-text-disabled)]">
        <p>🎉 没有待处理的自动记忆候选</p>
        {success && <p className="mt-2 text-[var(--color-digested)]">{success}</p>}
        <button onClick={() => loadItems()} className="mt-4 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text-secondary)]">刷新</button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between text-xs text-[var(--color-text-disabled)]">
        <span>{formatCandidateDate(candidate.date || item.date || item.created_at)}</span>
        <span>{current + 1}/{items.length}</span>
      </div>

      {success && <div className="mb-3 rounded-xl border border-[var(--color-digested-border)] bg-[var(--color-digested-bg)] px-4 py-2 text-sm text-[var(--color-digested)]">{success}</div>}
      {error && <div className="mb-3 rounded-xl border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-2 text-sm text-[var(--color-danger)]">{error}</div>}

      <div className="mb-4 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-6">
        {editing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-secondary)]">
              标题
              <input value={draft.title} maxLength={40} onChange={event => setDraft({ ...draft, title: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]" />
            </label>
            <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-secondary)]">
              正文
              <textarea value={draft.content} rows={8} onChange={event => setDraft({ ...draft, content: event.target.value })}
                className="mt-1.5 w-full resize-y rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]" />
            </label>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              类型
              <select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]">
                {KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              域（逗号分隔）
              <input value={draft.domain} onChange={event => setDraft({ ...draft, domain: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]" />
            </label>
            <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-secondary)]">
              标签（逗号分隔）
              <input value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]" />
            </label>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              重要度：{draft.importance}
              <input type="range" min="1" max="10" step="1" value={draft.importance}
                onChange={event => setDraft({ ...draft, importance: Number(event.target.value) })} className="mt-2 w-full accent-[var(--color-primary)]" />
            </label>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              置信度：{draft.confidence.toFixed(2)}
              <input type="range" min="0" max="1" step="0.01" value={draft.confidence}
                onChange={event => setDraft({ ...draft, confidence: Number(event.target.value) })} className="mt-2 w-full accent-[var(--color-primary)]" />
            </label>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <h2 className="text-lg font-semibold text-[var(--color-text-heading)] sm:text-xl">{candidate.title || '未命名候选'}</h2>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-[var(--color-surface-tertiary)] px-2.5 py-1 text-[var(--color-text-secondary)]">{KIND_LABELS[candidate.kind ?? ''] || candidate.kind || '类型未知'}</span>
                <span className="rounded-full bg-[var(--color-pending-bg)] px-2.5 py-1 text-[var(--color-pending)]">重要度 {candidate.importance ?? '—'}</span>
                <span className="rounded-full bg-[var(--color-resolved-bg)] px-2.5 py-1 text-[var(--color-resolved)]">置信度 {(candidate.confidence ?? 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="mb-4 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-elevated)] p-4 text-sm leading-relaxed text-[var(--color-text-primary)]">{candidate.content || '无正文'}</div>
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div><span className="text-[var(--color-text-disabled)]">域：</span>{(candidate.domain ?? []).join('、') || '—'}</div>
              <div><span className="text-[var(--color-text-disabled)]">标签：</span>{visibleTags.join('、') || '—'}</div>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button onClick={() => completeAction('confirm')} disabled={operating !== null}
          className="rounded-xl bg-[var(--color-digested-bg)] py-2.5 text-sm font-semibold text-[var(--color-digested)] disabled:opacity-50">
          {operating === 'confirm' ? '写入中…' : '写入长期记忆'}
        </button>
        <button onClick={() => completeAction('reject')} disabled={operating !== null}
          className="rounded-xl bg-[var(--color-danger-bg)] py-2.5 text-sm font-semibold text-[var(--color-danger)] disabled:opacity-50">
          {operating === 'reject' ? '拒绝中…' : '拒绝'}
        </button>
        <button onClick={() => {
          if (editing) setDraft(toDraft(candidate))
          setEditing(value => !value)
        }} disabled={operating !== null}
          className="rounded-xl border border-[var(--color-resolved-border)] bg-[var(--color-resolved-bg)] py-2.5 text-sm font-semibold text-[var(--color-resolved)] disabled:opacity-50">
          {editing ? '取消编辑' : '编辑候选'}
        </button>
      </div>

      {items.length > 1 && (
        <div className="mt-4 flex justify-between">
          <button onClick={() => selectItem(current - 1)} disabled={current === 0 || operating !== null}
            className="rounded-lg border border-[var(--color-border)] bg-white px-5 py-2 text-sm text-[var(--color-text-secondary)] disabled:opacity-40">← 上一条</button>
          <button onClick={() => selectItem(current + 1)} disabled={current === items.length - 1 || operating !== null}
            className="rounded-lg border border-[var(--color-border)] bg-white px-5 py-2 text-sm text-[var(--color-text-secondary)] disabled:opacity-40">下一条 →</button>
        </div>
      )}
    </div>
  )
}
