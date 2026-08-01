'use client'

import { useState } from 'react'
import { portraitApi } from './portraitApi'
import { ActionButton, Chip } from './portraitBits'
import type { AnchorProposal, ProfileFactProposal } from './portraitTypes'

type Message = { kind: 'ok' | 'error'; text: string } | null

/**
 * 画像候选 / Anchor 候选生成区。两个面板独立：填证据 bucket（画像可选 moment）→ 生成 → 确认写入。
 */
export default function PortraitProposalsSection({
  onFactsChanged,
}: {
  onFactsChanged: () => void
}) {
  const [factBucketId, setFactBucketId] = useState('')
  const [factMomentId, setFactMomentId] = useState('')
  const [factProposals, setFactProposals] = useState<ProfileFactProposal[]>([])
  const [factMessage, setFactMessage] = useState<Message>(null)
  const [factBusy, setFactBusy] = useState(false)

  const [anchorBucketId, setAnchorBucketId] = useState('')
  const [anchorProposals, setAnchorProposals] = useState<AnchorProposal[]>([])
  const [anchorBucketName, setAnchorBucketName] = useState('')
  const [anchorMessage, setAnchorMessage] = useState<Message>(null)
  const [anchorBusy, setAnchorBusy] = useState(false)

  const inputClass =
    'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]'
  const labelClass = 'mb-1 block text-xs text-[var(--color-text-tertiary)]'

  const generateFacts = async () => {
    const bucketId = factBucketId.trim()
    if (!bucketId) {
      setFactMessage({ kind: 'error', text: '先填证据 bucket id。' })
      return
    }
    setFactBusy(true)
    setFactMessage(null)
    try {
      const data = await portraitApi.generateFactProposals(bucketId, factMomentId.trim())
      const proposals = data.proposals || []
      const rejected = data.rejected || []
      setFactProposals(proposals)
      setFactMessage(
        proposals.length
          ? { kind: 'ok', text: `生成 ${proposals.length} 条候选。` }
          : rejected.length
            ? { kind: 'error', text: `没有可用候选，已拒绝 ${rejected.length} 条。` }
            : { kind: 'error', text: '没有生成候选。' },
      )
    } catch (e) {
      setFactProposals([])
      setFactMessage({ kind: 'error', text: e instanceof Error ? e.message : '生成失败' })
    } finally {
      setFactBusy(false)
    }
  }

  const confirmFact = async (proposal: ProfileFactProposal) => {
    if (!window.confirm(`确认写入画像事实？\n\n${proposal.fact || ''}`)) return
    setFactBusy(true)
    setFactMessage(null)
    try {
      const data = await portraitApi.confirmFactProposal(proposal)
      setFactMessage({ kind: 'ok', text: `已写入画像事实 ${data.id || ''}` })
      setFactProposals(prev => prev.filter(item => item !== proposal))
      onFactsChanged()
    } catch (e) {
      setFactMessage({ kind: 'error', text: e instanceof Error ? e.message : '写入失败' })
    } finally {
      setFactBusy(false)
    }
  }

  const generateAnchors = async () => {
    const bucketId = anchorBucketId.trim()
    if (!bucketId) {
      setAnchorMessage({ kind: 'error', text: '先填 bucket id。' })
      return
    }
    setAnchorBusy(true)
    setAnchorMessage(null)
    try {
      const data = await portraitApi.generateAnchorProposals(bucketId)
      const proposals = data.proposals || []
      const rejected = data.rejected || []
      const bucket = data.bucket || {}
      setAnchorProposals(proposals)
      setAnchorBucketName(String(bucket.name || ''))
      setAnchorMessage(
        proposals.length
          ? { kind: 'ok', text: `生成 ${proposals.length} 条 Anchor 候选。` }
          : rejected.length
            ? { kind: 'error', text: `没有可用候选：${rejected[0]?.reason || '已拒绝'}` }
            : { kind: 'error', text: '没有生成候选。' },
      )
    } catch (e) {
      setAnchorProposals([])
      setAnchorBucketName('')
      setAnchorMessage({ kind: 'error', text: e instanceof Error ? e.message : '生成失败' })
    } finally {
      setAnchorBusy(false)
    }
  }

  const confirmAnchor = async (proposal: AnchorProposal) => {
    if (!window.confirm(`确认标为 Anchor？\n\n${proposal.bucket_id || ''}`)) return
    setAnchorBusy(true)
    setAnchorMessage(null)
    try {
      const data = await portraitApi.confirmAnchorProposal(proposal)
      setAnchorMessage({
        kind: 'ok',
        text: data.status === 'already_anchor' ? '已经是 Anchor。' : `已标为 Anchor ${data.id || ''}`,
      })
      setAnchorProposals(prev => prev.filter(item => item !== proposal))
    } catch (e) {
      setAnchorMessage({ kind: 'error', text: e instanceof Error ? e.message : '写入失败' })
    } finally {
      setAnchorBusy(false)
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 shadow-sm sm:p-5">
      <h2 className="font-semibold text-[var(--color-text-heading)]">画像候选 / Anchor 候选</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
        从一个证据桶生成画像事实或 Anchor 候选，确认后写入记忆库。
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 画像候选 */}
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--color-text-heading)]">
            画像候选
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={labelClass}>证据 bucket id</label>
              <input
                className={inputClass}
                placeholder="bucket id"
                value={factBucketId}
                onChange={event => setFactBucketId(event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>moment id（可选）</label>
              <input
                className={inputClass}
                placeholder="moment id（可选）"
                value={factMomentId}
                onChange={event => setFactMomentId(event.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <ActionButton onClick={() => void generateFacts()} disabled={factBusy}>
              {factBusy ? '生成中…' : '生成画像候选'}
            </ActionButton>
          </div>
          {factMessage && (
            <div
              className={`mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs ${
                factMessage.kind === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {factMessage.text}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {factProposals.map((item, index) => (
              <div
                key={index}
                className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-3"
              >
                <div className="text-sm font-medium text-[var(--color-text-heading)]">
                  {item.fact || ''}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Chip>{item.profile_kind || 'other'}</Chip>
                  <Chip>{item.subject || 'user'}</Chip>
                  <Chip>{item.predicate || 'related_to'}</Chip>
                  <Chip>confidence {Number(item.confidence || 0).toFixed(2)}</Chip>
                </div>
                <div className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
                  object: {item.object || '—'}
                </div>
                <div className="text-[11px] text-[var(--color-text-disabled)]">
                  evidence: {item.evidence_bucket_id || ''}
                  {item.evidence_moment_id ? ` · ${item.evidence_moment_id}` : ''}
                </div>
                <div className="text-[11px] text-[var(--color-text-disabled)]">
                  reason: {item.reason || '—'}
                </div>
                <div className="mt-2">
                  <ActionButton onClick={() => void confirmFact(item)} disabled={factBusy}>
                    确认写入
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Anchor 候选 */}
        <div className="rounded-xl border border-[var(--color-border)] p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--color-text-heading)]">
            Anchor 候选
          </h3>
          <div>
            <label className={labelClass}>候选 anchor bucket id</label>
            <input
              className={inputClass}
              placeholder="候选 anchor bucket id"
              value={anchorBucketId}
              onChange={event => setAnchorBucketId(event.target.value)}
            />
          </div>
          <div className="mt-3">
            <ActionButton onClick={() => void generateAnchors()} disabled={anchorBusy}>
              {anchorBusy ? '生成中…' : '生成 Anchor 候选'}
            </ActionButton>
          </div>
          {anchorMessage && (
            <div
              className={`mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs ${
                anchorMessage.kind === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {anchorMessage.text}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {anchorProposals.map((item, index) => (
              <div
                key={index}
                className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-3"
              >
                <div className="text-sm font-medium text-[var(--color-text-heading)]">
                  {anchorBucketName || item.bucket_id || ''}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Chip>{item.anchor_kind || 'other'}</Chip>
                  <Chip>confidence {Number(item.confidence || 0).toFixed(2)}</Chip>
                  {(anchorBucketName || item.bucket_id) && <Chip>{anchorBucketName || item.bucket_id}</Chip>}
                </div>
                <div className="text-[11px] text-[var(--color-text-disabled)]">
                  bucket: {item.bucket_id || '—'}
                </div>
                <div className="text-[11px] text-[var(--color-text-disabled)]">
                  reason: {item.reason || '—'}
                </div>
                <div className="text-[11px] text-[var(--color-text-disabled)]">
                  future: {item.future_use || '—'}
                </div>
                <div className="mt-2">
                  <ActionButton onClick={() => void confirmAnchor(item)} disabled={anchorBusy}>
                    确认标为 Anchor
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
