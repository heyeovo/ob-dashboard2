'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Candidate = {
  id: string
  protectKey: string
  kind: 'ob_recall' | 'search_chat' | 'breath' | 'web_search' | 'web_fetch'
  label: string
  detail: string
  estimatedTokens: number
  protected: boolean
}

type History = {
  at: string
  mode: 'manual' | 'auto'
  released_tokens: number
  candidate_count: number
  counts?: Record<string, number>
}

type Payload = {
  ok: boolean
  error?: string
  candidates?: Candidate[]
  estimated_tokens?: number
  context_gc?: {
    auto_enabled?: boolean
    protected_keys?: string[]
    history?: History[]
  }
}

const BUTTON = 'rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10.5px] text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50'

function fmtTokens(value: number) {
  return value >= 1000 ? `约 ${(value / 1000).toFixed(1)}k token` : `约 ${value} token`
}

export default function CcContextGc({ sessionId, laneId, busy }: {
  sessionId: string
  laneId: string
  busy: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [protectedKeys, setProtectedKeys] = useState<string[]>([])
  const [history, setHistory] = useState<History[]>([])
  const [autoEnabled, setAutoEnabled] = useState(false)

  const scan = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ session_id: sessionId, lane_id: laneId })
      const response = await fetch(`/api/cc-context-gc?${query.toString()}`, { cache: 'no-store' })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok) throw new Error(payload.error || '扫描失败')
      setCandidates(payload.candidates || [])
      setProtectedKeys(payload.context_gc?.protected_keys || [])
      setHistory(payload.context_gc?.history || [])
      setAutoEnabled(payload.context_gc?.auto_enabled === true)
      setSelected(new Set())
    } catch (scanError) {
      setError((scanError as Error).message || '扫描失败')
    } finally {
      setLoading(false)
    }
  }, [laneId, sessionId])

  useEffect(() => { void scan() }, [scan])

  const selectedTokens = useMemo(
    () => candidates.filter(item => selected.has(item.id)).reduce((sum, item) => sum + item.estimatedTokens, 0),
    [candidates, selected],
  )

  const savePreferences = async (nextProtected: string[], nextAuto: boolean) => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/cc-context-gc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, protected_keys: nextProtected, auto_enabled: nextAuto }),
      })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok) throw new Error(payload.error || '保存失败')
      setProtectedKeys(nextProtected)
      setAutoEnabled(nextAuto)
      setCandidates(items => items.map(item => ({ ...item, protected: nextProtected.includes(item.protectKey) })))
      setSelected(current => new Set([...current].filter(id => !candidates.find(item => item.id === id && nextProtected.includes(item.protectKey)))))
    } catch (saveError) {
      setError((saveError as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleProtected = (candidate: Candidate) => {
    const next = protectedKeys.includes(candidate.protectKey)
      ? protectedKeys.filter(key => key !== candidate.protectKey)
      : [...protectedKeys, candidate.protectKey]
    void savePreferences(next, autoEnabled)
  }

  const run = async () => {
    if (selected.size === 0 || busy) return
    if (!window.confirm(`将复制当前 Claude 会话，并清理所选 ${selected.size} 项；Dashboard 窗口和正文不变，旧副本保留。继续吗？`)) return
    setRunning(true)
    setError('')
    setNote('正在复制并清理…')
    try {
      const response = await fetch('/api/cc-context-gc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, lane_id: laneId, selected_ids: [...selected], mode: 'manual' }),
      })
      const payload = await response.json() as Payload & { releasedTokens?: number; candidateCount?: number }
      if (!response.ok || !payload.ok) throw new Error(payload.error || '减负失败')
      setNote(`完成：清理 ${payload.candidateCount || selected.size} 项，约释放 ${(payload.releasedTokens || 0).toLocaleString()} token`)
      await scan()
    } catch (runError) {
      setError((runError as Error).message || '减负失败')
      setNote('')
    } finally {
      setRunning(false)
    }
  }

  const available = candidates.filter(item => !item.protected)
  return (
    <div className="text-[11px] text-[var(--color-text-secondary)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] p-3 leading-relaxed">
        只清理可重新获取的 OB 桶召回、breath、search_chat、WebSearch 和 WebFetch 结果。用户与助手正文、日期召回都不会改。实际执行时会复制 Claude 会话，旧副本暂时保留。
      </div>

      <div className="my-3 flex items-center justify-between gap-2">
        <div>
          <div className="font-medium text-[var(--color-text-heading)]">可清理内容</div>
          <div className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">默认不选择，由你决定本次清哪些。</div>
        </div>
        <button type="button" className={BUTTON} disabled={loading || running} onClick={() => void scan()}>{loading ? '扫描中…' : '重新扫描'}</button>
      </div>

      {!loading && candidates.length === 0 && !error ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3 text-[var(--color-text-tertiary)]">当前线路没有识别到可安全清理的内容。</div>
      ) : null}

      <div className="space-y-2">
        {candidates.map(item => (
          <div key={item.id} className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-2.5">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={item.protected || running}
                checked={selected.has(item.id)}
                onChange={event => setSelected(current => {
                  const next = new Set(current)
                  if (event.target.checked) next.add(item.id); else next.delete(item.id)
                  return next
                })}
              />
              <div className="min-w-0 flex-1">
                <div className="break-words text-[var(--color-text-heading)]">{item.label}</div>
                <div className="mt-0.5 break-all text-[9.5px] text-[var(--color-text-disabled)]">{item.detail} · 可释放 {fmtTokens(item.estimatedTokens)}</div>
              </div>
              <button type="button" className={BUTTON} disabled={saving || running} onClick={() => toggleProtected(item)}>
                {item.protected ? '取消保留' : '始终保留'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {available.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} disabled={running} onClick={() => setSelected(new Set(available.map(item => item.id)))}>全选可清理项</button>
          <button type="button" className={BUTTON} disabled={selected.size === 0 || running} onClick={() => setSelected(new Set())}>清空选择</button>
          <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">已选 {selected.size} 项 · {fmtTokens(selectedTokens)}</span>
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || running || selected.size === 0}
        onClick={() => void run()}
        className="mt-3 w-full rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-muted)] px-3 py-2 text-[11.5px] text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? '正在减负…' : busy ? '回复结束后可减负' : '清理所选内容'}
      </button>

      <div className="my-4 h-px bg-[var(--color-border-light)]" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-[var(--color-text-heading)]">每天 05:30 自动减负</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--color-text-disabled)]">默认关闭。开启后会等 04:30 日回顾和周一 05:00 轨迹桶结束；窗口忙碌或有待批准工具时跳过。</div>
        </div>
        <button
          type="button"
          className={BUTTON}
          disabled={saving}
          onClick={() => void savePreferences(protectedKeys, !autoEnabled)}
        >{autoEnabled ? '已开启' : '未开启'}</button>
      </div>

      {history.length > 0 ? (
        <>
          <div className="my-4 h-px bg-[var(--color-border-light)]" />
          <div className="mb-2 font-medium text-[var(--color-text-heading)]">最近记录</div>
          <div className="space-y-1.5">
            {[...history].reverse().slice(0, 5).map((item, index) => (
              <div key={`${item.at}-${index}`} className="flex justify-between gap-3 text-[10px] text-[var(--color-text-tertiary)]">
                <span>{new Date(item.at).toLocaleString('zh-HK', { hour12: false })} · {item.mode === 'auto' ? '自动' : '手动'}</span>
                <span>{item.candidate_count} 项 · 约 {Number(item.released_tokens || 0).toLocaleString()} token</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {note ? <div className="mt-3 text-[10.5px] text-[var(--color-digested)]">{note}</div> : null}
      {error ? <div className="mt-3 text-[10.5px] leading-relaxed text-[var(--color-danger)]">{error}</div> : null}
    </div>
  )
}
