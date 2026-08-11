'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AutomationRequestError,
  automationReviewErrorMessage,
  confirmJourneyCandidate,
  getJourneyCandidate,
  listJourneyCandidates,
  journeyCandidateStatusText,
  rejectJourneyCandidate,
  saveJourneyCandidate,
  type AutomationCandidate,
  type AutomationRun,
  type EvidenceBucket,
  type JourneyCandidateStatus,
  type JourneyCandidateType,
} from '../lib/journeyAutomation'

type CandidateDetail = {
  candidate: AutomationCandidate
  run: AutomationRun
}

type Props = {
  onOpenEvidence: (bucketId: string) => void
  onJourneyChanged: () => void | Promise<void>
}

const TYPE_LABELS: Record<JourneyCandidateType, string> = {
  no_change: '本周无需更新',
  append_current: '追加当前阶段',
  transition: '关闭旧阶段并创建新阶段',
}

function statusClass(status: JourneyCandidateStatus) {
  if (status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'conflict' || status === 'failed') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'rejected') return 'border-slate-200 bg-slate-50 text-slate-500'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

function displayTime(value?: string) {
  if (!value) return '尚无记录'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false })
}

function JsonPreview({ value }: { value: Record<string, unknown> | undefined }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
      {JSON.stringify(value || {}, null, 2)}
    </pre>
  )
}

function evidenceIds(candidate: AutomationCandidate) {
  if (candidate.candidate_type === 'append_current') {
    return Array.isArray(candidate.draft.evidence_bucket_ids)
      ? candidate.draft.evidence_bucket_ids.map(String)
      : []
  }
  if (candidate.candidate_type === 'transition') {
    const create = candidate.draft.create as Record<string, unknown> | undefined
    return Array.isArray(create?.evidence_bucket_ids)
      ? create.evidence_bucket_ids.map(String)
      : []
  }
  return []
}

export default function WeeklyJourneyReview({ onOpenEvidence, onJourneyChanged }: Props) {
  const [items, setItems] = useState<AutomationCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [detail, setDetail] = useState<CandidateDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, any>>({})
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([])
  const [working, setWorking] = useState<'save' | 'reject' | 'confirm' | ''>('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    setListError('')
    try {
      const response = await listJourneyCandidates('all')
      setItems(Array.isArray(response.items) ? response.items : [])
    } catch (error) {
      setListError(automationReviewErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  const openCandidate = async (candidateId: string) => {
    setDetailLoading(true)
    setNotice(null)
    setEditing(false)
    try {
      setDetail(await getJourneyCandidate(candidateId))
    } catch (error) {
      setNotice({ kind: 'error', text: automationReviewErrorMessage(error) })
    } finally {
      setDetailLoading(false)
    }
  }

  const beginEdit = () => {
    if (!detail) return
    setDraft(structuredClone(detail.candidate.draft || {}))
    setSelectedEvidenceIds(evidenceIds(detail.candidate))
    setNotice(null)
    setEditing(true)
  }

  const availableEvidence = detail?.run.input_summary?.materials || []
  const chosenEvidence = useMemo(() => {
    const known = new Map<string, EvidenceBucket>()
    for (const item of availableEvidence) known.set(item.id, { id: item.id, name: item.name })
    for (const item of detail?.candidate.draft_evidence || []) known.set(item.id, item)
    return selectedEvidenceIds.map(id => known.get(id) || { id, name: id })
  }, [availableEvidence, detail?.candidate.draft_evidence, selectedEvidenceIds])

  const currentEvidence = useMemo(() => {
    if (!detail) return []
    const known = new Map<string, EvidenceBucket>()
    for (const item of availableEvidence) known.set(item.id, { id: item.id, name: item.name })
    for (const item of detail.candidate.draft_evidence || []) known.set(item.id, item)
    for (const item of detail.candidate.evidence || []) known.set(item.id, item)
    return evidenceIds(detail.candidate).map(id => known.get(id) || { id, name: id })
  }, [availableEvidence, detail])

  const buildDraft = () => {
    if (!detail) return {}
    if (detail.candidate.candidate_type === 'append_current') {
      return {
        append_content: String(draft.append_content || ''),
        summary: String(draft.summary || ''),
        evidence_bucket_ids: selectedEvidenceIds,
      }
    }
    if (detail.candidate.candidate_type === 'transition') {
      return {
        close: {
          stage_end: String(draft.close?.stage_end || ''),
          summary: String(draft.close?.summary || ''),
        },
        create: {
          name: String(draft.create?.name || ''),
          stage_start: String(draft.create?.stage_start || ''),
          summary: String(draft.create?.summary || ''),
          content: String(draft.create?.content || ''),
          evidence_bucket_ids: selectedEvidenceIds,
        },
      }
    }
    return {}
  }

  const applyErrorCandidate = (error: unknown) => {
    if (error instanceof AutomationRequestError && error.payload.candidate && detail) {
      setDetail({ ...detail, candidate: error.payload.candidate })
    }
  }

  const saveDraft = async () => {
    if (!detail) return
    setWorking('save')
    setNotice(null)
    try {
      const response = await saveJourneyCandidate(
        detail.candidate.candidate_id,
        detail.candidate.revision,
        buildDraft(),
      )
      setDetail({ ...detail, candidate: response.candidate })
      setEditing(false)
      setNotice({ kind: 'success', text: `已保存为 revision ${response.candidate.revision}，hash 已更新。` })
      await loadCandidates()
    } catch (error) {
      applyErrorCandidate(error)
      setNotice({ kind: 'error', text: automationReviewErrorMessage(error) })
    } finally {
      setWorking('')
    }
  }

  const rejectCandidate = async () => {
    if (!detail || !window.confirm('拒绝后不会写入 journey。确定拒绝这条候选吗？')) return
    setWorking('reject')
    setNotice(null)
    try {
      await rejectJourneyCandidate(detail.candidate.candidate_id, detail.candidate.revision)
      setNotice({ kind: 'success', text: '候选已拒绝，journey 没有发生写入。' })
      setDetail(null)
      await loadCandidates()
    } catch (error) {
      applyErrorCandidate(error)
      setNotice({ kind: 'error', text: automationReviewErrorMessage(error) })
    } finally {
      setWorking('')
    }
  }

  const confirmCandidate = async () => {
    if (!detail) return
    const hash = detail.candidate.draft_payload_hash || detail.candidate.approved_payload_hash || ''
    if (!hash) {
      setNotice({ kind: 'error', text: '当前候选没有可确认的服务端 hash，请先刷新。' })
      return
    }
    if (!window.confirm('确认将严格执行页面所示 revision/hash；浏览器不会另送一份正文。继续吗？')) return
    setWorking('confirm')
    setNotice(null)
    try {
      const response = await confirmJourneyCandidate(detail.candidate)
      setNotice({
        kind: 'success',
        text: response.status === 'replayed' ? '该候选已执行，已回放保存结果。' : '候选已确认并完成执行。',
      })
      setDetail(null)
      await Promise.all([loadCandidates(), Promise.resolve(onJourneyChanged())])
    } catch (error) {
      applyErrorCandidate(error)
      setNotice({ kind: 'error', text: automationReviewErrorMessage(error) })
      await loadCandidates()
    } finally {
      setWorking('')
    }
  }

  const pendingCount = items.filter(item => item.status === 'pending').length
  const current = detail?.candidate
  const input = detail?.run.input_summary
  const actionable = current?.status === 'pending'
  const retryable = current?.status === 'failed'

  return (
    <section className="mb-8 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">每周关系轨迹候选</h2>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">{pendingCount} 条待确认</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">只在这里人工确认后才会修改 journey；关闭页面不会写入。</p>
        </div>
        <Link href="/settings/automation" className="text-xs text-[var(--color-primary)]">自动化状态与手动生成 →</Link>
      </div>

      {notice && (
        <div className={`mb-4 rounded-xl border px-3 py-2 text-xs leading-5 ${notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {notice.text}
          {notice.kind === 'error' && /重新生成|journey|冲突/.test(notice.text) && (
            <Link href="/settings/automation" className="ml-2 underline">去重新生成候选</Link>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-disabled)]">读取候选中…</div>
      ) : listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {listError}
          <button onClick={() => void loadCandidates()} className="ml-3 underline">重试</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] py-7 text-center text-sm text-[var(--color-text-disabled)]">还没有 weekly journey 候选</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map(item => (
            <button
              key={item.candidate_id}
              onClick={() => void openCandidate(item.candidate_id)}
              className="rounded-xl border border-[var(--color-border)] p-3 text-left transition-colors hover:border-[var(--color-primary)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{TYPE_LABELS[item.candidate_type] || item.candidate_type}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusClass(item.status)}`}>{journeyCandidateStatusText(item.status)}</span>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[var(--color-text-tertiary)]">
                <span>revision {item.revision}</span>
                <span>{displayTime(item.updated_at || item.created_at)}</span>
              </div>
              {item.error && <div className="mt-2 line-clamp-2 text-xs text-red-600">{item.error}</div>}
            </button>
          ))}
        </div>
      )}

      {(detailLoading || detail) && (
        <div className="mt-5 border-t border-[var(--color-border)] pt-5">
          {detailLoading || !current ? (
            <div className="py-10 text-center text-sm text-[var(--color-text-disabled)]">读取候选详情中…</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{TYPE_LABELS[current.candidate_type]}</div>
                  <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                    {detail.run.window_start?.slice(0, 10)} 至 {detail.run.window_end?.slice(0, 10)} · {detail.run.timezone || 'Asia/Hong_Kong'}
                  </div>
                </div>
                <button onClick={() => { setDetail(null); setEditing(false) }} className="text-xs text-[var(--color-text-tertiary)]">收起</button>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">状态</div><div className="mt-1 text-sm">{journeyCandidateStatusText(current.status)}</div></div>
                <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">revision</div><div className="mt-1 font-mono text-sm">{current.revision}</div></div>
                <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">日回顾</div><div className="mt-1 text-sm">{input?.daily_review_count ?? 0} 天</div></div>
                <div className="rounded-xl bg-[var(--color-surface-secondary)] p-3"><div className="text-[10px] text-[var(--color-text-tertiary)]">输入材料</div><div className="mt-1 text-sm">{input?.material_count ?? 0} 个桶</div></div>
              </div>

              <section>
                <h3 className="mb-2 text-xs font-semibold text-[var(--color-text-tertiary)]">输入完整性</h3>
                <div className={`rounded-xl border px-3 py-2 text-sm ${(input?.missing_daily_review_dates || []).length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {(input?.missing_daily_review_dates || []).length
                    ? `缺少日回顾：${input?.missing_daily_review_dates?.join('、')}`
                    : '本周每日回顾完整'}
                  <div className="mt-1 text-xs opacity-80">协作者：{input?.persona?.name || input?.persona?.id || '未标注'}；开放阶段：{input?.current_journey?.name || input?.current_journey?.id || '未找到'}</div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold text-[var(--color-text-tertiary)]">判断依据</h3>
                <ul className="space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {current.rationale.map((line, index) => <li key={`${line}-${index}`}>• {line}</li>)}
                </ul>
              </section>

              {!editing ? (
                <>
                  <section>
                    <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-[var(--color-text-tertiary)]">当前 draft</h3><span className="text-[10px] text-[var(--color-text-disabled)]">服务端规范化版本</span></div>
                    <JsonPreview value={current.draft} />
                  </section>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold text-[var(--color-text-tertiary)]">预计写入差异</h3>
                    <JsonPreview value={current.draft_preview || current.preview} />
                  </section>
                </>
              ) : current.candidate_type === 'append_current' ? (
                <div className="space-y-4">
                  <label className="block"><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">追加正文</span><textarea rows={10} value={String(draft.append_content || '')} onChange={event => setDraft(value => ({ ...value, append_content: event.target.value }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm leading-6" /></label>
                  <label className="block"><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">更新后阶段摘要</span><textarea rows={4} value={String(draft.summary || '')} onChange={event => setDraft(value => ({ ...value, summary: event.target.value }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm leading-6" /></label>
                </div>
              ) : current.candidate_type === 'transition' ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">旧阶段结束日期</span><input type="date" value={String(draft.close?.stage_end || '')} onChange={event => setDraft(value => ({ ...value, close: { ...value.close, stage_end: event.target.value } }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm" /></label>
                    <label><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">新阶段开始日期</span><input type="date" value={String(draft.create?.stage_start || '')} onChange={event => setDraft(value => ({ ...value, create: { ...value.create, stage_start: event.target.value } }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm" /></label>
                  </div>
                  <label className="block"><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">旧阶段收束摘要</span><textarea rows={4} value={String(draft.close?.summary || '')} onChange={event => setDraft(value => ({ ...value, close: { ...value.close, summary: event.target.value } }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm leading-6" /></label>
                  <label className="block"><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">新阶段标题</span><input value={String(draft.create?.name || '')} onChange={event => setDraft(value => ({ ...value, create: { ...value.create, name: event.target.value } }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm" /></label>
                  <label className="block"><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">新阶段摘要</span><textarea rows={4} value={String(draft.create?.summary || '')} onChange={event => setDraft(value => ({ ...value, create: { ...value.create, summary: event.target.value } }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm leading-6" /></label>
                  <label className="block"><span className="mb-1 block text-xs text-[var(--color-text-tertiary)]">新阶段正文</span><textarea rows={12} value={String(draft.create?.content || '')} onChange={event => setDraft(value => ({ ...value, create: { ...value.create, content: event.target.value } }))} className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm leading-6" /></label>
                </div>
              ) : null}

              {current.candidate_type !== 'no_change' && (
                <section>
                  <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-[var(--color-text-tertiary)]">证据桶</h3><span className="text-[10px] text-[var(--color-text-disabled)]">只能选择本次固定输入快照内的桶</span></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(editing ? availableEvidence : currentEvidence).map(bucket => {
                      const selected = selectedEvidenceIds.includes(bucket.id)
                      return (
                        <div key={bucket.id} className={`flex items-center gap-2 rounded-xl border p-3 ${editing && selected ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)]'}`}>
                          {editing && <input type="checkbox" checked={selected} onChange={() => setSelectedEvidenceIds(ids => selected ? ids.filter(id => id !== bucket.id) : [...ids, bucket.id])} />}
                          <button type="button" onClick={() => onOpenEvidence(bucket.id)} className="min-w-0 flex-1 text-left">
                            <div className="truncate text-sm font-medium">{bucket.name}</div>
                            <div className="truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">{bucket.id}</div>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {editing && chosenEvidence.length === 0 && <div className="mt-2 text-xs text-amber-700">写入型候选至少需要一个证据桶。</div>}
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold text-[var(--color-text-tertiary)]">原始 preview（不可变）</h3>
                <JsonPreview value={current.preview} />
              </section>

              <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">当前批准 hash</div>
                <div className="mt-1 break-all font-mono text-[11px]">{current.draft_payload_hash || current.approved_payload_hash || '当前状态无可确认 hash'}</div>
              </section>

              {current.error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{current.error}</div>}

              <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                {editing ? (
                  <>
                    <button onClick={() => setEditing(false)} disabled={Boolean(working)} className="px-4 py-2 text-sm text-[var(--color-text-tertiary)]">取消编辑</button>
                    <button onClick={() => void saveDraft()} disabled={Boolean(working)} className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-50">{working === 'save' ? '保存中…' : '保存为新 revision'}</button>
                  </>
                ) : (
                  <>
                    {actionable && current.candidate_type !== 'no_change' && <button onClick={beginEdit} disabled={Boolean(working)} className="rounded-full border border-[var(--color-border)] px-4 py-2 text-sm">编辑候选</button>}
                    {actionable && <button onClick={() => void rejectCandidate()} disabled={Boolean(working)} className="rounded-full border border-red-200 px-4 py-2 text-sm text-red-600">{working === 'reject' ? '拒绝中…' : '拒绝'}</button>}
                    {(actionable || retryable) && <button onClick={() => void confirmCandidate()} disabled={Boolean(working)} className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-50">{working === 'confirm' ? '确认中…' : retryable ? '重试已冻结执行' : '确认当前 revision/hash'}</button>}
                    {(current.status === 'conflict' || current.status === 'failed') && <Link href="/settings/automation" className="rounded-full border border-[var(--color-border)] px-4 py-2 text-sm">重新生成候选</Link>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
