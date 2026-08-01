'use client'

import { useState } from 'react'
import PortraitEditor from './PortraitEditor'
import { portraitApi } from './portraitApi'
import {
  ActionButton,
  Chip,
  EmptyText,
  EvidenceLine,
  formatDate,
  formatTs,
  portraitScopeLabel,
  rowMetaChips,
  rowText,
} from './portraitBits'
import type {
  PortraitDeleteSpec,
  PortraitRow,
  PortraitScope,
  PortraitScopeState,
  PortraitStatePayload,
} from './portraitTypes'

/**
 * Portrait State 区：状态摘要、自我总入口、Current Focus、user/relationship 两域、
 * 生成记录与候选（折叠）。stable 编辑走内嵌 PortraitEditor。
 */
export default function PortraitStateCard({
  state,
  onReload,
}: {
  state: PortraitStatePayload
  onReload: () => void
}) {
  const [editorScope, setEditorScope] = useState<PortraitScope | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const deleteRow = async (spec: PortraitDeleteSpec) => {
    if (!window.confirm('删除这条画像记录？')) return
    try {
      await portraitApi.deleteItem(spec)
      setMessage({ kind: 'ok', text: '已删除画像记录。' })
      onReload()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  const scopeState = (scope: PortraitScope): PortraitScopeState =>
    (state.portrait && state.portrait[scope]) || {}

  const personaScope = scopeState('persona')
  const selfEntry = state.self_anchor_entry || {}
  const selfCore = selfEntry.text || selfEntry.name || selfEntry.bucket_id || ''

  const timelineRows = (state.recent_timeline?.length ? state.recent_timeline : state.recent_activities)
    ?.slice(0, 8) || []
  const timelineArea = state.recent_timeline?.length ? 'recent_timeline' : 'recent_activities'

  const focusRows = String(state.current_focus || '')
    .split(/\r?\n/)
    .filter(Boolean)

  const candidates: Array<{
    title: string
    area: 'stable_candidates' | 'profile_fact_candidates'
    rows: PortraitRow[]
  }> = [
    { title: 'Stable Candidates', area: 'stable_candidates', rows: state.stable_candidates || [] },
    {
      title: 'Profile Fact Candidates',
      area: 'profile_fact_candidates',
      rows: state.profile_fact_candidates || [],
    },
  ]

  const summaryChips: Array<[string, boolean]> = [
    ['engine', Boolean(state.enabled)],
    ['auto', Boolean(state.auto_enabled)],
    ['auto initial', Boolean(state.auto_initial_enabled)],
    ['daily', Boolean(state.daily_enabled)],
  ]

  const renderRow = (row: PortraitRow, spec: PortraitDeleteSpec) => (
    <div key={`${spec.area}-${spec.index ?? rowText(row)}`} className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]/45 p-3">
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">
        {rowText(row)}
      </div>
      {(rowMetaChips(row).length > 0 || spec) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {rowMetaChips(row).map((part, index) => (
            <Chip key={index}>{part}</Chip>
          ))}
          <ActionButton variant="danger" onClick={() => void deleteRow(spec)}>
            删除
          </ActionButton>
        </div>
      )}
      <EvidenceLine evidence={row.evidence} />
    </div>
  )

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--color-text-heading)]">Portrait State</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
            后台每天维护的换窗画像；只在 breath/handoff 开场恢复，不随普通对话逐轮注入。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {summaryChips.map(([label, ok]) => (
            <Chip key={label} title={ok ? '开启' : '关闭'}>
              {label} {ok ? 'on' : 'off'}
            </Chip>
          ))}
          {state.last_run_date && <Chip>last run {formatDate(state.last_run_date)}</Chip>}
          {state.updated_at && <Chip>updated {formatTs(state.updated_at)}</Chip>}
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

      {/* 自我总入口 */}
      <div className="mb-4 rounded-xl border border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-[var(--color-text-heading)]">自我总入口</h3>
          <ActionButton onClick={() => setEditorScope('persona')}>编辑</ActionButton>
        </div>
        <div className="mt-2 text-sm leading-relaxed text-[var(--color-text-primary)]">
          {selfCore || '还没有自我总入口。'}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip>{selfEntry.configured ? '自我总入口' : '自我总入口 fallback'}</Chip>
          {personaScope.stable_revision != null && (
            <Chip>revision {personaScope.stable_revision}</Chip>
          )}
          <Chip>{personaScope.stable_locked ? 'locked' : 'auto update'}</Chip>
        </div>
        {selfEntry.bucket_id && (
          <EvidenceLine
            evidence={[{ bucket_id: selfEntry.bucket_id, name: selfEntry.name, exists: true }]}
          />
        )}
      </div>

      {/* Current Focus */}
      <div className="mb-4 rounded-xl border border-[var(--color-border)] p-4">
        <div className="text-xs font-medium text-[var(--color-text-tertiary)]">
          Current Focus · handoff 实际注入
        </div>
        {focusRows.length ? (
          <div className="mt-2 space-y-1">
            {focusRows.map((line, index) => (
              <p key={index} className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                {line}
              </p>
            ))}
          </div>
        ) : (
          <EmptyText>最近 7 天没有 current focus。</EmptyText>
        )}
      </div>

      {/* user / relationship 两域 */}
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        {(['user', 'relationship'] as PortraitScope[]).map(scope => {
          const inner = scopeState(scope)
          const stable = String(inner.stable || '').trim()
          return (
            <div key={scope} className="rounded-xl border border-[var(--color-border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-[var(--color-text-heading)]">
                  {portraitScopeLabel(scope)}
                </h3>
                <ActionButton onClick={() => setEditorScope(scope)}>编辑</ActionButton>
              </div>
              <div className={`mt-2 text-sm leading-relaxed ${stable ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-disabled)]'}`}>
                {stable || 'Stable 尚未生成。'}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {inner.stable_revision != null && <Chip>revision {inner.stable_revision}</Chip>}
                <Chip>{inner.stable_locked ? 'locked' : 'auto update'}</Chip>
                {inner.stable_source && <Chip>{inner.stable_source}</Chip>}
              </div>
            </div>
          )
        })}
      </div>

      {/* 生成记录与候选 */}
      <details className="rounded-xl border border-[var(--color-border)] p-4">
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-heading)]">
          生成记录与候选
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
              Recent Timeline
            </div>
            {timelineRows.length ? (
              <div className="space-y-2">
                {timelineRows.map((row, index) =>
                  renderRow(row, { area: timelineArea, index, text: rowText(row) }),
                )}
              </div>
            ) : (
              <EmptyText>还没有 recent timeline。</EmptyText>
            )}
          </div>
          {candidates.map(group => (
            <div key={group.area}>
              <div className="mb-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
                {group.title}
              </div>
              {group.rows.length ? (
                <div className="space-y-2">
                  {group.rows
                    .map((row, index) => ({ row, index }))
                    .slice(-8)
                    .reverse()
                    .map(({ row, index }) =>
                      renderRow(row, { area: group.area, index, text: rowText(row) }),
                    )}
                </div>
              ) : (
                <EmptyText>没有候选。</EmptyText>
              )}
            </div>
          ))}
        </div>
      </details>

      {editorScope && (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-[var(--color-text-heading)]">
              编辑 · {portraitScopeLabel(editorScope)}
            </h3>
            <button
              type="button"
              onClick={() => setEditorScope(null)}
              className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:bg-black/5"
            >
              收起
            </button>
          </div>
          <PortraitEditor
            scope={editorScope}
            scopeState={scopeState(editorScope)}
            selfAnchorEntry={selfEntry}
            onChanged={() => {
              setMessage(null)
              onReload()
            }}
            onMessage={setMessage}
          />
        </div>
      )}
    </section>
  )
}
