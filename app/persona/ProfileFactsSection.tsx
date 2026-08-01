'use client'

import { useState } from 'react'
import { portraitApi } from './portraitApi'
import { ActionButton, Chip, formatTs } from './portraitBits'
import type { ProfileFact } from './portraitTypes'

type Message = { kind: 'ok' | 'error'; text: string } | null

interface EditForm {
  fact: string
  profile_kind: string
  subject: string
  predicate: string
  object: string
  confidence: string
  evidence_context: string
  reflection: string
  followup: string
}

function factStatus(fact: ProfileFact): { text: string; active: boolean } {
  if (fact.deprecated || fact.state === 'deprecated') return { text: 'deprecated', active: false }
  if (fact.active || fact.state === 'active') return { text: 'active', active: true }
  return { text: fact.state || 'inactive', active: false }
}

/**
 * Profile Facts 区：旧画像事实卡证据检查。每条支持确认 / 编辑 / 废弃 / 删除。
 */
export default function ProfileFactsSection({
  facts,
  onChanged,
}: {
  facts: ProfileFact[] | null
  onChanged: () => void
}) {
  const [message, setMessage] = useState<Message>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ kind: 'ok', text: okText })
      onChanged()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '操作失败' })
    } finally {
      setBusy(false)
    }
  }

  const confirmFact = (fact: ProfileFact) => {
    void run(() => portraitApi.updateFact(fact.id || '', { action: 'confirm' }), '画像事实已确认。')
  }

  const deprecateFact = (fact: ProfileFact) => {
    if (!window.confirm(`废弃这条画像事实？\n\n${fact.fact || ''}`)) return
    void run(
      () => portraitApi.updateFact(fact.id || '', { action: 'deprecate' }),
      '画像事实已废弃。',
    )
  }

  const deleteFact = (fact: ProfileFact) => {
    if (!window.confirm(`彻底删除这条画像事实？\n\n${fact.fact || ''}`)) return
    void run(() => portraitApi.deleteFact(fact.id || ''), '画像事实已删除。')
  }

  const startEdit = (fact: ProfileFact) => {
    const sections = fact.sections || {}
    setForm({
      fact: fact.fact || '',
      profile_kind: fact.kind || 'preference',
      subject: fact.subject || 'user',
      predicate: fact.predicate || '',
      object: fact.object || '',
      confidence: fact.confidence == null ? '0.9' : String(fact.confidence),
      evidence_context: sections.evidence_context || '',
      reflection: sections.reflection || '',
      followup: sections.followup || '',
    })
    setEditingId(fact.id || null)
  }

  const submitEdit = (id: string) => {
    if (!form) return
    const confidence = Number(form.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      setMessage({ kind: 'error', text: 'confidence 须为 0~1' })
      return
    }
    const payload: Record<string, unknown> = {
      action: 'edit',
      fact: form.fact,
      profile_kind: form.profile_kind,
      subject: form.subject,
      predicate: form.predicate,
      object: form.object,
      confidence,
    }
    if (form.evidence_context) payload.evidence_context = form.evidence_context
    if (form.reflection) payload.reflection = form.reflection
    if (form.followup) payload.followup = form.followup
    void run(
      () => portraitApi.updateFact(id, payload),
      '画像事实已更新。',
    )
    setEditingId(null)
    setForm(null)
  }

  const list = facts || []
  const activeCount = list.filter(fact => factStatus(fact).active).length
  const deprecatedCount = list.filter(fact => fact.deprecated || fact.state === 'deprecated').length

  const inputClass =
    'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]'
  const labelClass = 'mb-1 block text-xs text-[var(--color-text-tertiary)]'

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--color-text-heading)]">Profile Facts</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
            旧画像事实卡仅保留作证据检查；不会再把原文直接拼进每轮上下文。
          </p>
        </div>
        <div className="text-xs text-[var(--color-text-secondary)]">
          {list.length} 条画像事实 · {activeCount} active · {deprecatedCount} deprecated
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 rounded-[var(--radius-md)] border px-3 py-2 text-xs ${
            message.kind === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {list.length === 0 ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-disabled)]">
          还没有画像事实。
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(fact => {
            const id = fact.id || ''
            const status = factStatus(fact)
            const conf = fact.confidence == null ? '—' : Number(fact.confidence).toFixed(2)
            const updated = fact.updated_at || fact.last_active || fact.created || ''
            const isEditing = editingId === id
            return (
              <article
                key={id}
                className="rounded-xl border border-[var(--color-border)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text-heading)]">
                      {fact.fact || ''}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip title={status.text}>{status.text}</Chip>
                      <Chip>{fact.kind || 'unknown'}</Chip>
                      <Chip>confidence {conf}</Chip>
                      <Chip>{fact.source || 'profile_fact'}</Chip>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {!status.active && (
                      <ActionButton onClick={() => confirmFact(fact)} disabled={busy}>
                        确认
                      </ActionButton>
                    )}
                    <ActionButton onClick={() => startEdit(fact)} disabled={busy}>
                      编辑
                    </ActionButton>
                    <ActionButton variant="danger" onClick={() => deprecateFact(fact)} disabled={busy}>
                      废弃
                    </ActionButton>
                    <ActionButton variant="danger" onClick={() => deleteFact(fact)} disabled={busy}>
                      删除
                    </ActionButton>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  <div>
                    <span className="text-[var(--color-text-disabled)]">subject </span>
                    {fact.subject || '—'}
                  </div>
                  <div>
                    <span className="text-[var(--color-text-disabled)]">predicate </span>
                    {fact.predicate || '—'}
                  </div>
                  <div>
                    <span className="text-[var(--color-text-disabled)]">object </span>
                    {fact.object || '—'}
                  </div>
                  <div>
                    <span className="text-[var(--color-text-disabled)]">updated </span>
                    {formatTs(updated) || '—'}
                  </div>
                  <div>
                    <span className="text-[var(--color-text-disabled)]">bucket </span>
                    {id}
                  </div>
                  <div className="truncate">
                    <span className="text-[var(--color-text-disabled)]">tags </span>
                    {(fact.tags || []).join(', ') || '—'}
                  </div>
                </div>

                <div className="mt-2 space-y-0.5 text-[11px] text-[var(--color-text-disabled)]">
                  {(fact.evidence || []).length ? (
                    fact.evidence!.map((item, index) => {
                      const bucketId = item.bucket_id || ''
                      const label =
                        (item.name || bucketId) + (item.moment_id ? ` · ${item.moment_id}` : '')
                      return (
                        <div key={index}>
                          {label}
                          {bucketId && (
                            <a
                              className="ml-1.5 text-[var(--color-primary)]"
                              href={`/bucket/${bucketId}`}
                            >
                              打开证据
                            </a>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div>未记录证据。</div>
                  )}
                </div>

                {isEditing && form && (
                  <div className="mt-4 rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className={labelClass}>画像事实</label>
                        <input
                          className={inputClass}
                          value={form.fact}
                          onChange={event => setForm({ ...form, fact: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>kind</label>
                        <input
                          className={inputClass}
                          value={form.profile_kind}
                          onChange={event => setForm({ ...form, profile_kind: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>subject</label>
                        <input
                          className={inputClass}
                          value={form.subject}
                          onChange={event => setForm({ ...form, subject: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>predicate</label>
                        <input
                          className={inputClass}
                          value={form.predicate}
                          onChange={event => setForm({ ...form, predicate: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>object</label>
                        <input
                          className={inputClass}
                          value={form.object}
                          onChange={event => setForm({ ...form, object: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>confidence 0~1</label>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          className={inputClass}
                          value={form.confidence}
                          onChange={event => setForm({ ...form, confidence: event.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelClass}>evidence context</label>
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={form.evidence_context}
                          onChange={event =>
                            setForm({ ...form, evidence_context: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className={labelClass}>reflection</label>
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={form.reflection}
                          onChange={event => setForm({ ...form, reflection: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>followup</label>
                        <textarea
                          rows={2}
                          className={inputClass}
                          value={form.followup}
                          onChange={event => setForm({ ...form, followup: event.target.value })}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <ActionButton onClick={() => submitEdit(id)} disabled={busy}>
                        保存修改
                      </ActionButton>
                      <ActionButton
                        onClick={() => {
                          setEditingId(null)
                          setForm(null)
                        }}
                      >
                        取消
                      </ActionButton>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
