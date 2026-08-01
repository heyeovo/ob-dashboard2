'use client'

import { useState } from 'react'
import { portraitApi } from './portraitApi'
import { ActionButton, Chip, EmptyText, EvidenceLine, formatTs, rowText } from './portraitBits'
import type {
  PortraitDeleteSpec,
  PortraitRow,
  PortraitScope,
  PortraitScopeState,
  SelfAnchorEntry,
} from './portraitTypes'

type Message = { kind: 'ok' | 'error'; text: string } | null

/**
 * stable 编辑面板：保存 / 锁定 / 清空 / 回滚 + 生成依据三层（current delta / staging pool / recent buffer）。
 * 所有写操作带 expected_revision 乐观锁，成功后回调 onChanged 重拉（revision 会 +1）。
 */
export default function PortraitEditor({
  scope,
  scopeState,
  selfAnchorEntry,
  onChanged,
  onMessage,
}: {
  scope: PortraitScope
  scopeState: PortraitScopeState
  selfAnchorEntry?: SelfAnchorEntry
  onChanged: () => void
  onMessage: (message: Message) => void
}) {
  const [text, setText] = useState(scopeState.stable || '')
  const [prevStable, setPrevStable] = useState(scopeState.stable)
  const [busy, setBusy] = useState(false)

  // 渲染期派生 state：外部 stable 变化（保存/回滚/清空后重拉）才重置草稿，
  // 用户正在编辑时不受影响。这是 React 官方替代 useEffect 同步的方案。
  if (scopeState.stable !== prevStable) {
    setPrevStable(scopeState.stable)
    setText(scopeState.stable || '')
  }

  const revision = Number(scopeState.stable_revision || 0)
  const locked = scopeState.stable_locked === true
  const isPersona = scope === 'persona'
  const selfCore =
    (selfAnchorEntry && (selfAnchorEntry.text || selfAnchorEntry.name || selfAnchorEntry.bucket_id)) || ''

  const meta = [
    `revision ${revision}`,
    locked ? 'locked' : 'auto update',
    scopeState.stable_source || '',
    scopeState.stable_updated_at ? formatTs(scopeState.stable_updated_at) : '',
  ].filter(Boolean)

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    onMessage(null)
    try {
      await action()
      onMessage({ kind: 'ok', text: okText })
      onChanged()
    } catch (e) {
      onMessage({ kind: 'error', text: e instanceof Error ? e.message : '操作失败' })
    } finally {
      setBusy(false)
    }
  }

  const saveStable = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      onMessage({ kind: 'error', text: 'stable 不能为空；需要清空时请使用清空按钮。' })
      return
    }
    void run(() => portraitApi.saveStable(scope, trimmed, revision), 'stable 已保存。')
  }

  const toggleLock = () => {
    void run(
      () => portraitApi.toggleStableLock(scope, !locked, revision),
      locked ? 'stable 已恢复后台自动更新。' : 'stable 已锁定。',
    )
  }

  const clearStable = () => {
    if (!scopeState.stable) return
    if (!window.confirm('清空这段 stable portrait？当前文本会保留在历史版本里。')) return
    void run(
      () =>
        portraitApi.deleteItem({
          area: 'portrait',
          scope,
          layer: 'stable',
          text: scopeState.stable || '',
        } as PortraitDeleteSpec),
      'stable 已清空，旧文本仍在历史版本里。',
    )
  }

  const rollback = (targetRevision: number) => {
    if (!window.confirm(`回退 stable 到 revision ${targetRevision}？当前版本仍会保留在历史里。`)) return
    void run(
      () => portraitApi.rollbackStable(scope, targetRevision, revision),
      'stable 已回退，并保留当前版本。',
    )
  }

  const deleteEvidence = (row: PortraitRow, layer: string, index?: number) => {
    if (!window.confirm('删除这条画像记录？')) return
    void run(
      () =>
        portraitApi.deleteItem({
          area: 'portrait',
          scope,
          layer,
          index,
          text: rowText(row),
        }),
      '已删除画像记录。',
    )
  }

  const history = (scopeState.stable_history || []).slice().reverse().slice(0, 8)

  const renderEvidenceRows = (rows: PortraitRow[], layer: string) =>
    rows.slice(0, 12).map((row, index) => (
      <div
        key={`${layer}-${index}`}
        className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-3"
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">
          {rowText(row)}
        </div>
        <div className="mt-2">
          <ActionButton variant="danger" onClick={() => deleteEvidence(row, layer, index)}>
            删除
          </ActionButton>
        </div>
        <EvidenceLine evidence={row.evidence} />
      </div>
    ))

  const midRows: PortraitRow[] = scopeState.mid_term
    ? [{ text: scopeState.mid_term, evidence: scopeState.mid_term_evidence }]
    : []
  const stagingRows: PortraitRow[] = scopeState.staging_pool || []
  const recentRows: PortraitRow[] = scopeState.recent_buffer || []
  const evidenceCount = midRows.length + stagingRows.length + recentRows.length

  return (
    <div className="space-y-4">
      {meta.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.map((part, index) => (
            <Chip key={index}>{part}</Chip>
          ))}
        </div>
      )}

      {isPersona && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
            原始核心 · 只读
          </div>
          <div className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-3">
            {selfCore ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">
                {selfCore}
              </p>
            ) : (
              <EmptyText>还没有自我总入口。</EmptyText>
            )}
            {selfAnchorEntry?.bucket_id && (
              <EvidenceLine evidence={[{ bucket_id: selfAnchorEntry.bucket_id }]} />
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
            原始核心保持第一人称原文且不会被后台改写；这里只编辑它后来长出的「现在的我」。
          </p>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
          {isPersona ? '现在的我 · 自动生长' : 'Stable'}
        </div>
        <textarea
          value={text}
          onChange={event => setText(event.target.value)}
          rows={5}
          placeholder={isPersona ? '还没有长出新的第一人称自我理解。' : '还没有 stable portrait。'}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <ActionButton onClick={saveStable} disabled={busy}>
            保存
          </ActionButton>
          <ActionButton onClick={toggleLock} disabled={busy}>
            {locked ? '解锁自动更新' : '锁定'}
          </ActionButton>
          {scopeState.stable && (
            <ActionButton variant="danger" onClick={clearStable} disabled={busy}>
              清空
            </ActionButton>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <details className="rounded-xl border border-[var(--color-border)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-heading)]">
            历史版本 {history.length}
          </summary>
          <div className="mt-2 space-y-2">
            {history.map(row => {
              const targetRevision = Number(row.revision || 0)
              return (
                <div
                  key={targetRevision}
                  className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-3"
                >
                  <div className="text-[11px] text-[var(--color-text-disabled)]">
                    revision {targetRevision} · {row.source || 'unknown'} ·{' '}
                    {formatTs(row.updated_at)}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">
                    {row.text || ''}
                  </div>
                  <div className="mt-2">
                    <ActionButton onClick={() => rollback(targetRevision)} disabled={busy}>
                      回退到这里
                    </ActionButton>
                  </div>
                </div>
              )
            })}
          </div>
        </details>
      )}

      <details className="rounded-xl border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-heading)]">
          生成依据 <span className="text-[var(--color-text-disabled)]">{evidenceCount} 条</span>
        </summary>
        <div className="mt-2 space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--color-text-tertiary)]">
              current delta
            </div>
            {midRows.length ? renderEvidenceRows(midRows, 'mid_term') : <EmptyText>还没有 current delta。</EmptyText>}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--color-text-tertiary)]">
              staging pool
            </div>
            {stagingRows.length ? (
              renderEvidenceRows(stagingRows, 'staging_pool')
            ) : (
              <EmptyText>staging pool 为空。</EmptyText>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-[var(--color-text-tertiary)]">
              recent buffer
            </div>
            {recentRows.length ? (
              renderEvidenceRows(recentRows, 'recent_buffer')
            ) : (
              <EmptyText>recent buffer 为空。</EmptyText>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
