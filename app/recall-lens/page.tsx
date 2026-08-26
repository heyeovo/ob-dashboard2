'use client'

import { useMemo, useState } from 'react'
import Card from '../components/Card'
import DataBadge from '../components/DataBadge'
import FilterBar, { FilterPill } from '../components/FilterBar'
import {
  getRecallRuleCopy,
  RECALL_EFFECT_LABEL,
  type RecallRuleEffect,
} from './recallReasonCopy'

type Candidate = {
  bucket_id?: string
  bucket_name?: string
  admission_reason?: string
  score?: number
  semantic_score?: number
  keyword_score?: number
  evidence_labels?: string[]
  hard_evidence_labels?: string[]
  content_preview?: string
  recall_why?: {
    primary_source?: string
  }
}

type DebugPayload = {
  query_preview?: string
  recalled_bucket_debug?: Candidate[]
  suppressed_bucket_candidates?: Candidate[]
  hook_recall_debug?: {
    search_query?: string
    candidate_count?: number
    mode?: string
  }
  memory_sentinel_debug?: {
    searchable_residue_terms?: string[]
  }
  query_planner_debug?: {
    errors?: string[]
    trigger_reason?: string
    timing_ms?: Record<string, number>
    recall_query_plan?: {
      activated_axis_terms?: string[]
      specific_terms?: string[]
    }
    dynamic_anchor?: {
      discriminative_terms?: string[]
      required_terms?: string[]
    }
  }
}

type DebugRound = {
  id: number
  session_id: string
  round_id: number
  created_at: string
  payload: DebugPayload
}

type DebugResponse = {
  items?: DebugRound[]
  error?: string
}

type RoundFilter = 'all' | 'recalled' | 'suppressed' | 'degraded'

export default function RecallLensPage() {
  const [sessionId, setSessionId] = useState('')
  const [rounds, setRounds] = useState<DebugRound[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [filter, setFilter] = useState<RoundFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selected = rounds.find((round) => round.id === selectedId) || null

  const filteredRounds = useMemo(() => rounds.filter((round) => {
    const recalled = round.payload.recalled_bucket_debug?.length || 0
    const suppressed = round.payload.suppressed_bucket_candidates?.length || 0
    const degraded = round.payload.query_planner_debug?.errors?.length || 0
    if (filter === 'recalled') return recalled > 0
    if (filter === 'suppressed') return suppressed > 0 && recalled === 0
    if (filter === 'degraded') return degraded > 0
    return true
  }), [filter, rounds])

  const stats = useMemo(() => ({
    recalledRounds: rounds.filter((round) => (round.payload.recalled_bucket_debug?.length || 0) > 0).length,
    recalledBuckets: rounds.reduce((sum, round) => sum + (round.payload.recalled_bucket_debug?.length || 0), 0),
    suppressedBuckets: rounds.reduce((sum, round) => sum + (round.payload.suppressed_bucket_candidates?.length || 0), 0),
    degradedRounds: rounds.filter((round) => (round.payload.query_planner_debug?.errors?.length || 0) > 0).length,
  }), [rounds])

  async function loadSession() {
    const cleanSessionId = sessionId.trim()
    if (!cleanSessionId) {
      setError('请先输入 session ID')
      return
    }

    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        session_id: cleanSessionId,
        include_payload: '1',
        limit: '100',
      })
      const response = await fetch(`/api/gateway/api/debug/injections?${params}`, { cache: 'no-store' })
      const data = await response.json() as DebugResponse
      if (!response.ok) throw new Error(data.error || `读取失败（${response.status}）`)

      const nextRounds = [...(data.items || [])].sort((a, b) => b.round_id - a.round_id)
      setRounds(nextRounds)
      setSelectedId(nextRounds[0]?.id ?? null)
      if (!nextRounds.length) setError('这个 session 暂时没有召回记录')
    } catch (loadError) {
      setRounds([])
      setSelectedId(null)
      setError(loadError instanceof Error ? loadError.message : '读取召回记录失败')
    } finally {
      setLoading(false)
    }
  }

  function selectRound(roundId: number) {
    setSelectedId(roundId)
    if (window.innerWidth < 1024) {
      window.setTimeout(() => {
        document.getElementById('recall-round-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-base font-semibold text-[var(--color-text-heading)] sm:text-lg">召回透镜</h1>
            <p className="text-xs text-[var(--color-text-tertiary)]">看清每一轮为什么召回、为什么拒绝</p>
          </div>
          {rounds.length > 0 && (
            <span className="rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--color-primary)]">
              {rounds.length} 轮
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-8">
        <Card padding="lg" className="mb-5">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void loadSession()
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Session ID</span>
              <input
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                placeholder="例如 ob2-20260821-mu4pah"
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-primary)]"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="self-end rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-[var(--color-surface)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? '读取中…' : '读取召回记录'}
            </button>
          </form>
          {error && (
            <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </Card>

        {rounds.length > 0 && (
          <>
            <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="总轮次" value={rounds.length} />
              <StatTile label="发生召回" value={stats.recalledRounds} />
              <StatTile label="注入桶" value={stats.recalledBuckets} />
              <StatTile label="被拒候选" value={stats.suppressedBuckets} note={`${stats.degradedRounds} 轮系统降级`} />
            </section>

            <FilterBar className="mb-4">
              <FilterPill label="全部" active={filter === 'all'} onClick={() => setFilter('all')} />
              <FilterPill label="发生召回" active={filter === 'recalled'} onClick={() => setFilter('recalled')} />
              <FilterPill label="整轮未召回" active={filter === 'suppressed'} onClick={() => setFilter('suppressed')} />
              <FilterPill label="系统降级" active={filter === 'degraded'} onClick={() => setFilter('degraded')} />
            </FilterBar>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.7fr)]">
              <section className="order-2 space-y-2 lg:order-1 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
                {filteredRounds.map((round) => (
                  <RoundListCard
                    key={round.id}
                    round={round}
                    selected={round.id === selectedId}
                    onSelect={() => selectRound(round.id)}
                  />
                ))}
                {!filteredRounds.length && (
                  <Card variant="empty" className="text-center text-sm text-[var(--color-text-tertiary)]">
                    当前筛选下没有轮次
                  </Card>
                )}
              </section>

              <section id="recall-round-detail" className="order-1 scroll-mt-20 lg:order-2">
                {selected ? (
                  <RoundDetail round={selected} />
                ) : (
                  <Card variant="empty" padding="lg" className="text-center text-sm text-[var(--color-text-tertiary)]">
                    选择一轮查看完整召回轨迹
                  </Card>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function StatTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card variant="ghost" padding="sm">
      <p className="text-xs text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--color-text-heading)]">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-[var(--color-pending)]">{note}</p>}
    </Card>
  )
}

function RoundListCard({ round, selected, onSelect }: { round: DebugRound; selected: boolean; onSelect: () => void }) {
  const recalled = round.payload.recalled_bucket_debug?.length || 0
  const suppressed = round.payload.suppressed_bucket_candidates?.length || 0
  const degraded = round.payload.query_planner_debug?.errors?.length || 0

  return (
    <button type="button" onClick={onSelect} className="block w-full text-left">
      <Card
        variant="interactive"
        padding="sm"
        className={selected ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]' : ''}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--color-text-heading)]">Round {round.round_id}</span>
          <span className="text-[11px] text-[var(--color-text-disabled)]">{formatTime(round.created_at)}</span>
        </div>
        <p className="line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          {round.payload.query_preview || '没有 query preview'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {recalled > 0 && <MiniStatus effect="allow">注入 {recalled}</MiniStatus>}
          {suppressed > 0 && <MiniStatus effect="reject">拒绝 {suppressed}</MiniStatus>}
          {degraded > 0 && <MiniStatus effect="degraded">系统降级</MiniStatus>}
          {recalled === 0 && suppressed === 0 && <MiniStatus effect="info">未进入召回</MiniStatus>}
        </div>
      </Card>
    </button>
  )
}

function RoundDetail({ round }: { round: DebugRound }) {
  const payload = round.payload
  const recalled = payload.recalled_bucket_debug || []
  const suppressed = payload.suppressed_bucket_candidates || []
  const errors = payload.query_planner_debug?.errors || []
  const axisTerms = payload.query_planner_debug?.recall_query_plan?.activated_axis_terms || []
  const anchorTerms = payload.query_planner_debug?.dynamic_anchor?.required_terms || []
  const residueTerms = payload.memory_sentinel_debug?.searchable_residue_terms || []

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-[var(--color-text-tertiary)]">Round {round.round_id}</p>
            <p className="text-sm font-semibold text-[var(--color-text-heading)]">本轮输入</p>
          </div>
          <span className="text-xs text-[var(--color-text-disabled)]">{formatTime(round.created_at, true)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">
          {payload.query_preview || '没有 query preview'}
        </p>
      </Card>

      <Card padding="lg" className="bg-[var(--color-primary-muted)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">系统怎样理解这句话</h2>
          {errors.length > 0
            ? <MiniStatus effect="degraded">降级路径</MiniStatus>
            : <MiniStatus effect="info">正常路径</MiniStatus>}
        </div>
        <InfoRow label="实际搜索词" value={payload.hook_recall_debug?.search_query || '未生成'} />
        <InfoRow label="清理后词组" value={formatTerms(residueTerms)} />
        <InfoRow label="核心主题轴" value={formatTerms(axisTerms)} />
        <InfoRow label="必需锚点" value={formatTerms(anchorTerms)} />
        <InfoRow label="候选数量" value={String(payload.hook_recall_debug?.candidate_count ?? '未知')} />
        {errors.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-[var(--color-border-light)] pt-3">
            {errors.map((code) => <RuleExplanation key={code} code={code} />)}
          </div>
        )}
      </Card>

      <CandidateSection title={`最终注入 · ${recalled.length}`} candidates={recalled} recalled />
      <CandidateSection title={`被拒候选 · ${suppressed.length}`} candidates={suppressed} />
    </div>
  )
}

function CandidateSection({ title, candidates, recalled = false }: { title: string; candidates: Candidate[]; recalled?: boolean }) {
  const [expanded, setExpanded] = useState(recalled)
  const visibleCandidates = recalled || expanded ? candidates : candidates.slice(0, 3)

  return (
    <Card padding="lg">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">{title}</h2>
        {candidates.length > 0 && (
          <span className="text-xs text-[var(--color-primary)]">
            {expanded ? '收起' : `展开全部 ${candidates.length} 个`}
          </span>
        )}
      </button>

      {candidates.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] px-3 py-4 text-center text-sm text-[var(--color-text-tertiary)]">
          {recalled ? '本轮没有注入长期记忆' : '本轮没有被拒候选'}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {visibleCandidates.map((candidate, index) => (
            <CandidateCard
              key={`${candidate.bucket_id || candidate.bucket_name || 'candidate'}-${index}`}
              candidate={candidate}
              recalled={recalled}
            />
          ))}
          {!recalled && !expanded && candidates.length > 3 && (
            <p className="text-center text-xs text-[var(--color-text-tertiary)]">
              另有 {candidates.length - 3} 个候选已折叠
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function CandidateCard({ candidate, recalled }: { candidate: Candidate; recalled: boolean }) {
  const evidence = Array.from(new Set([
    ...(candidate.evidence_labels || []),
    ...(candidate.hard_evidence_labels || []),
  ]))

  return (
    <div className={`rounded-[var(--radius-lg)] border p-3 ${
      recalled
        ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]'
        : 'border-[var(--color-border)] bg-[var(--color-surface)]'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-text-heading)]">
              {candidate.bucket_name || '未命名桶'}
            </h3>
            <MiniStatus effect={recalled ? 'allow' : 'reject'}>{recalled ? '已注入' : '已拒绝'}</MiniStatus>
          </div>
          {candidate.bucket_id && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">{candidate.bucket_id}</p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <DataBadge label="总分" value={formatScore(candidate.score)} size="xs" />
          <DataBadge label="语义" value={formatScore(candidate.semantic_score)} size="xs" />
          <DataBadge label="关键词" value={formatScore(candidate.keyword_score)} size="xs" />
        </div>
      </div>

      {candidate.recall_why?.primary_source && (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          主要来源：{sourceLabel(candidate.recall_why.primary_source)}
        </p>
      )}

      {candidate.admission_reason && (
        <div className="mt-3">
          <RuleExplanation code={candidate.admission_reason} />
        </div>
      )}

      {evidence.length > 0 && (
        <details className="mt-2 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">
            查看评分证据 · {evidence.length}
          </summary>
          <div className="mt-2 space-y-2">
            {evidence.map((code) => <RuleExplanation key={code} code={code} compact />)}
          </div>
        </details>
      )}

      {candidate.content_preview && (
        <details className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">查看记忆摘要</summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--color-text-secondary)]">
            {candidate.content_preview}
          </p>
        </details>
      )}
    </div>
  )
}

function RuleExplanation({ code, compact = false }: { code: string; compact?: boolean }) {
  const copy = getRecallRuleCopy(code)
  return (
    <details className={`rounded-[var(--radius-md)] ${effectSurface(copy.effect)} ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center gap-2">
          <MiniStatus effect={copy.effect}>{RECALL_EFFECT_LABEL[copy.effect]}</MiniStatus>
          <span className="text-xs font-medium text-[var(--color-text-primary)]">{copy.title}</span>
        </div>
      </summary>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">{copy.description}</p>
      <p className="mt-1 text-[11px] text-[var(--color-text-disabled)]">内部规则：{code}</p>
    </details>
  )
}

function MiniStatus({ effect, children }: { effect: RecallRuleEffect; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${effectBadge(effect)}`}>
      {children}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-t border-[var(--color-border-light)] py-2 first:border-t-0 sm:grid-cols-[110px_1fr] sm:gap-3">
      <span className="text-xs text-[var(--color-text-tertiary)]">{label}</span>
      <span className="break-words text-xs leading-5 text-[var(--color-text-primary)]">{value}</span>
    </div>
  )
}

function effectBadge(effect: RecallRuleEffect) {
  if (effect === 'allow') return 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
  if (effect === 'reject') return 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
  if (effect === 'score') return 'bg-[var(--color-semantic-bg)] text-[var(--color-semantic)]'
  if (effect === 'degraded') return 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]'
  return 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]'
}

function effectSurface(effect: RecallRuleEffect) {
  if (effect === 'allow') return 'bg-[var(--color-primary-soft)]'
  if (effect === 'reject') return 'bg-[var(--color-danger-bg)]'
  if (effect === 'score') return 'bg-[var(--color-semantic-bg)]'
  if (effect === 'degraded') return 'bg-[var(--color-pending-bg)]'
  return 'bg-[var(--color-surface-secondary)]'
}

function formatTerms(terms: string[]) {
  return terms.length ? terms.join(' · ') : '未提取'
}

function formatScore(score?: number) {
  return typeof score === 'number' ? score.toFixed(3) : '—'
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    keyword: '关键词检索',
    semantic: '语义检索',
    exact_anchor: '精确锚点',
    retrieval_alias: '稳定别名',
    entity_edge: '实体关系提示',
    planner_lexical: '查询规划器的关键词结果',
  }
  return labels[source] || source
}

function formatTime(value: string, includeDate = false) {
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: includeDate ? '2-digit' : undefined,
    day: includeDate ? '2-digit' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
