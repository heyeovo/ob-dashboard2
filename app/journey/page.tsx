'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import BucketDetailDrawer from '../components/BucketDetailDrawer'
import DetailPanel from '../components/DetailPanel'

interface JourneyStage {
  id: string
  name: string
  journey_start: string
  journey_end: string
  journey_status: 'open' | 'closed' | 'unmarked'
  journey_summary: string
  journey_source_bucket_ids: string[]
  missing_fields: string[]
}

interface EvidenceBucket {
  id: string
  name: string
  exists: boolean
}

interface JourneyDetail extends JourneyStage {
  content: string
  evidence_buckets: EvidenceBucket[]
}

interface SearchBucket {
  id: string
  name: string
  domain?: string[]
}

function displayDate(value: string) {
  return value ? value.slice(0, 10) : '未标注'
}

function statusText(status: JourneyStage['journey_status']) {
  if (status === 'open') return '进行中'
  if (status === 'closed') return '已结束'
  return '未标注'
}

function statusClass(status: JourneyStage['journey_status']) {
  if (status === 'open') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'closed') return 'bg-slate-50 text-slate-500 border-slate-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

export default function JourneyPage() {
  const [stages, setStages] = useState<JourneyStage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<JourneyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [form, setForm] = useState({
    name: '',
    journey_start: '',
    journey_end: '',
    journey_status: 'unmarked' as JourneyStage['journey_status'],
    journey_summary: '',
    content: '',
  })
  const [editEvidence, setEditEvidence] = useState<EvidenceBucket[]>([])
  const [evidenceQuery, setEvidenceQuery] = useState('')
  const [evidenceResults, setEvidenceResults] = useState<SearchBucket[]>([])
  const [evidenceSearching, setEvidenceSearching] = useState(false)

  const [selectedBucket, setSelectedBucket] = useState<any>(null)
  const [bucketLoading, setBucketLoading] = useState(false)
  const [bucketEditing, setBucketEditing] = useState(false)
  const [bucketEditContent, setBucketEditContent] = useState('')
  const [bucketSaving, setBucketSaving] = useState(false)
  const [bucketOperating, setBucketOperating] = useState(false)
  const [bucketCopied, setBucketCopied] = useState(false)

  const loadStages = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/journeys', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '读取轨迹失败')
      setStages(Array.isArray(data.journeys) ? data.journeys : [])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStages() }, [loadStages])

  const openStage = async (stageId: string) => {
    setDetailLoading(true)
    setEditing(false)
    setSaveError('')
    try {
      const res = await fetch(`/api/journeys/${stageId}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '读取阶段失败')
      setDetail(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setDetailLoading(false)
    }
  }

  const startEdit = () => {
    if (!detail) return
    setForm({
      name: detail.name,
      journey_start: detail.journey_start.slice(0, 10),
      journey_end: detail.journey_end.slice(0, 10),
      journey_status: detail.journey_status,
      journey_summary: detail.journey_summary,
      content: detail.content,
    })
    setEditEvidence(detail.evidence_buckets)
    setEvidenceQuery('')
    setEvidenceResults([])
    setSaveError('')
    setEditing(true)
  }

  const searchEvidence = async () => {
    const query = evidenceQuery.trim()
    if (!query) return
    setEvidenceSearching(true)
    try {
      const params = new URLSearchParams({
        q: query,
        show_all: 'true',
        include_archive: 'true',
        limit: '8',
      })
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      const rows = Array.isArray(data) ? data : (data.results ?? [])
      const selectedIds = new Set(editEvidence.map(item => item.id))
      setEvidenceResults(rows.filter((item: SearchBucket) =>
        !item.domain?.includes('journey') && !selectedIds.has(item.id)
      ))
    } catch {
      setEvidenceResults([])
    } finally {
      setEvidenceSearching(false)
    }
  }

  const addEvidence = (bucket: SearchBucket) => {
    setEditEvidence(current => [
      ...current,
      { id: bucket.id, name: bucket.name || bucket.id, exists: true },
    ])
    setEvidenceResults(current => current.filter(item => item.id !== bucket.id))
  }

  const saveJourney = async () => {
    if (!detail) return
    setSaving(true)
    setSaveError('')
    const payload: Record<string, unknown> = {
      name: form.name,
      journey_start: form.journey_start,
      journey_summary: form.journey_summary,
      content: form.content,
      journey_source_bucket_ids: editEvidence.map(item => item.id),
    }
    if (form.journey_status === 'open' || form.journey_status === 'closed') {
      payload.journey_status = form.journey_status
      payload.journey_end = form.journey_status === 'closed' ? form.journey_end : ''
    }
    try {
      const res = await fetch(`/api/journeys/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '保存失败')
      setDetail(data)
      setEditing(false)
      await loadStages()
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const openEvidenceBucket = async (bucketId: string) => {
    setBucketLoading(true)
    setSelectedBucket(null)
    setBucketEditing(false)
    try {
      const res = await fetch(`/api/bucket/${bucketId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '读取证据桶失败')
      setSelectedBucket(data)
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setBucketLoading(false)
    }
  }

  const refreshSelectedBucket = async () => {
    if (!selectedBucket) return
    const res = await fetch(`/api/bucket/${selectedBucket.id}`)
    if (res.ok) setSelectedBucket(await res.json())
  }

  const traceBucket = async (id: string, args: Record<string, unknown>) => {
    setBucketOperating(true)
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...args }),
    })
    await refreshSelectedBucket()
    setBucketOperating(false)
  }

  const saveBucketEdit = async () => {
    if (!selectedBucket) return
    setBucketSaving(true)
    await fetch('/api/edit-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedBucket.id, content: bucketEditContent }),
    })
    await refreshSelectedBucket()
    setBucketEditing(false)
    setBucketSaving(false)
  }

  const openCount = useMemo(
    () => stages.filter(stage => stage.journey_status === 'open').length,
    [stages],
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 px-3 backdrop-blur-sm md:hidden">
        <span className="text-sm font-semibold">关系轨迹</span>
      </header>

      <main className="mx-auto max-w-4xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs tracking-[0.2em] text-[var(--color-text-tertiary)]">RELATIONSHIP JOURNEY</p>
            <h1 className="text-2xl font-semibold">关系轨迹</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">按阶段回看关系如何一路走到这里。</p>
          </div>
          <div className="text-right text-xs text-[var(--color-text-tertiary)]">
            <div>{stages.length} 个阶段</div>
            <div>{openCount} 个进行中</div>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-[var(--color-text-disabled)]">读取中…</div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : stages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] py-16 text-center text-sm text-[var(--color-text-disabled)]">还没有关系轨迹</div>
        ) : (
          <div className="relative space-y-4 before:absolute before:bottom-5 before:left-[9px] before:top-5 before:w-px before:bg-[var(--color-border)]">
            {stages.map(stage => (
              <button
                key={stage.id}
                onClick={() => openStage(stage.id)}
                className="group relative flex w-full gap-4 text-left"
              >
                <span className={`relative z-[1] mt-5 h-[19px] w-[19px] flex-none rounded-full border-4 border-[var(--color-bg)] ${stage.journey_status === 'open' ? 'bg-emerald-500' : 'bg-[var(--color-primary)]'}`} />
                <span className="block flex-1 rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:border-[var(--color-primary)]/40 group-hover:shadow-md sm:p-5">
                  <span className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {displayDate(stage.journey_start)} → {stage.journey_status === 'open' ? '至今' : displayDate(stage.journey_end)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(stage.journey_status)}`}>
                      {statusText(stage.journey_status)}
                    </span>
                  </span>
                  <span className="block font-medium text-[var(--color-text-primary)]">{stage.name}</span>
                  <span className="mt-2 line-clamp-3 block text-sm leading-relaxed text-[var(--color-text-secondary)]">{stage.journey_summary}</span>
                  {stage.missing_fields.length > 0 && (
                    <span className="mt-3 block text-[11px] text-amber-600">旧阶段有 {stage.missing_fields.length} 项结构字段未标注</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      <DetailPanel open={detailLoading || Boolean(detail)} onClose={() => { setDetail(null); setEditing(false) }} mode="modal" width="max-w-4xl">
        {detailLoading || !detail ? (
          <div className="py-24 text-center text-sm text-[var(--color-text-disabled)]">读取中…</div>
        ) : (
          <div className="flex max-h-[82vh] flex-col">
            <div className="flex-1 overflow-y-auto px-1 custom-scroll">
              {!editing ? (
                <>
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-5">
                    <div>
                      <div className="mb-2 text-xs text-[var(--color-text-tertiary)]">
                        {displayDate(detail.journey_start)} → {detail.journey_status === 'open' ? '至今' : displayDate(detail.journey_end)}
                      </div>
                      <h2 className="text-xl font-semibold">{detail.name}</h2>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${statusClass(detail.journey_status)}`}>{statusText(detail.journey_status)}</span>
                  </div>

                  <section className="mb-6 rounded-2xl bg-[var(--color-surface-secondary)] p-4">
                    <div className="mb-2 text-xs font-medium text-[var(--color-text-tertiary)]">阶段摘要</div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{detail.journey_summary}</p>
                  </section>

                  <section className="mb-7">
                    <h3 className="mb-3 text-sm font-semibold">完整正文与关键事件</h3>
                    <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--color-text-secondary)]">{detail.content}</div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">证据桶</h3>
                      <span className="text-xs text-[var(--color-text-tertiary)]">{detail.evidence_buckets.length} 个</span>
                    </div>
                    {detail.evidence_buckets.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-text-disabled)]">尚未绑定证据桶</div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {detail.evidence_buckets.map(bucket => (
                          <button
                            key={bucket.id}
                            disabled={!bucket.exists}
                            onClick={() => openEvidenceBucket(bucket.id)}
                            className="rounded-xl border border-[var(--color-border)] p-3 text-left transition-colors hover:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="text-sm font-medium">{bucket.name}</div>
                            <div className="mt-1 font-mono text-[11px] text-[var(--color-text-tertiary)]">{bucket.id}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="sm:col-span-2">
                      <span className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">阶段标题</span>
                      <input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">开始日期</span>
                      <input type="date" value={form.journey_start} onChange={event => setForm(current => ({ ...current, journey_start: event.target.value }))} className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">状态</span>
                      <select value={form.journey_status} onChange={event => setForm(current => ({ ...current, journey_status: event.target.value as JourneyStage['journey_status'] }))} className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm">
                        <option value="unmarked">未标注（旧阶段）</option>
                        <option value="open">进行中</option>
                        <option value="closed">已结束</option>
                      </select>
                    </label>
                    {form.journey_status === 'closed' && (
                      <label>
                        <span className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">结束日期</span>
                        <input type="date" value={form.journey_end} onChange={event => setForm(current => ({ ...current, journey_end: event.target.value }))} className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm" />
                      </label>
                    )}
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">阶段摘要</span>
                    <textarea value={form.journey_summary} onChange={event => setForm(current => ({ ...current, journey_summary: event.target.value }))} rows={3} className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--color-primary)]" />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs text-[var(--color-text-tertiary)]">完整正文与关键事件</span>
                    <textarea value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} rows={16} className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm leading-7 outline-none focus:border-[var(--color-primary)]" />
                  </label>

                  <section>
                    <div className="mb-2 text-xs text-[var(--color-text-tertiary)]">证据桶（名称 + ID）</div>
                    <div className="mb-3 space-y-2">
                      {editEvidence.map(bucket => (
                        <div key={bucket.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{bucket.name}</div>
                            <div className="truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">{bucket.id}</div>
                          </div>
                          <button onClick={() => setEditEvidence(current => current.filter(item => item.id !== bucket.id))} className="flex-none text-xs text-red-500">移除</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={evidenceQuery}
                        onChange={event => setEvidenceQuery(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); searchEvidence() } }}
                        placeholder="按桶名称或 ID 搜索"
                        className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
                      />
                      <button onClick={searchEvidence} disabled={evidenceSearching || !evidenceQuery.trim()} className="rounded-xl bg-[var(--color-surface-secondary)] px-4 py-2 text-sm disabled:opacity-50">{evidenceSearching ? '搜索中…' : '搜索'}</button>
                    </div>
                    {evidenceResults.length > 0 && (
                      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-white p-2">
                        {evidenceResults.map(bucket => (
                          <button key={bucket.id} onClick={() => addEvidence(bucket)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--color-surface-secondary)]">
                            <span className="truncate text-sm">{bucket.name || bucket.id}</span>
                            <span className="flex-none font-mono text-[10px] text-[var(--color-text-tertiary)]">{bucket.id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
              <div className="text-xs text-red-600">{saveError}</div>
              {!editing ? (
                <button onClick={startEdit} className="rounded-full border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-secondary)]">人工纠错</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-[var(--color-text-tertiary)]">取消</button>
                  <button onClick={saveJourney} disabled={saving} className="rounded-full bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-50">{saving ? '保存中…' : '保存更改'}</button>
                </div>
              )}
            </div>
          </div>
        )}
      </DetailPanel>

      <BucketDetailDrawer
        selected={selectedBucket}
        detailLoading={bucketLoading}
        editing={bucketEditing}
        editContent={bucketEditContent}
        saving={bucketSaving}
        operating={bucketOperating}
        copied={bucketCopied}
        onClose={() => setSelectedBucket(null)}
        onStartEdit={content => { setBucketEditContent(content); setBucketEditing(true) }}
        onCancelEdit={() => setBucketEditing(false)}
        onSaveEdit={saveBucketEdit}
        onTraceOp={traceBucket}
        onCopyId={() => {
          if (!selectedBucket) return
          navigator.clipboard.writeText(selectedBucket.id)
          setBucketCopied(true)
          setTimeout(() => setBucketCopied(false), 1500)
        }}
        onTouch={async id => { await fetch(`/api/touch/${id}`, { method: 'POST' }); await refreshSelectedBucket() }}
        onArchive={async id => {
          const isArchived = selectedBucket?.metadata?.type === 'archived' || selectedBucket?.type === 'archived'
          await fetch(isArchived ? `/api/unarchive/${id}` : `/api/archive/${id}`, { method: 'POST' })
          await refreshSelectedBucket()
        }}
        onActivate={async id => { await fetch(`/api/touch/${id}?ripple=true`, { method: 'POST' }) }}
      />
    </div>
  )
}
