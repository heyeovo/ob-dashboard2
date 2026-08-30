'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CcMcpConfig } from '@/app/lib/ccMcpTypes'
import type { HandoffSnapshot } from '@/app/lib/cc/handoffSnapshot'
import type { CcContextAnalysisResult, CcExactContextAnalysis } from '@/app/lib/cc/contextAnalysis'
import {
  estimateContextTokens,
  estimateMcpConfigTokens,
  estimateWebToolTokens,
} from '@/app/lib/contextTokenEstimate'
import type { CcProviderKind } from './upstream'
import type { CcWebSettings } from './webSettings'

type Props = {
  sessionId: string
  systemPromptText: string
  conversationText: string
  actualTokens: number
  maxTokens: number
  web: CcWebSettings
  cred: CcProviderKind
  providerId: string
  live: boolean
  busy: boolean
}

const COLORS = [
  'var(--color-primary)',
  'var(--color-primary-gradient)',
  'var(--color-resolved)',
  'var(--color-digested)',
  'var(--color-pinned)',
  'var(--color-text-disabled)',
]

function fmtK(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`
  return String(value)
}

function categoryLabel(name: string) {
  const value = name.trim().toLowerCase()
  if (value.includes('system prompt')) return '系统提示词'
  if (value.includes('system tool')) return '内置工具'
  if (value.includes('mcp')) return 'MCP 工具'
  if (value.includes('message')) return '消息历史'
  if (value.includes('memory')) return '记忆文件'
  if (value.includes('skill')) return 'Skills'
  if (value.includes('agent')) return 'Agents'
  if (value.includes('command')) return 'Slash Commands'
  if (value.includes('free') || value.includes('remaining')) return '剩余空间'
  return name || '其他'
}

function sumTokens(items: Array<{ tokens: number }> | undefined) {
  return (items || []).reduce((sum, item) => sum + item.tokens, 0)
}

function TokenCard({
  title,
  hint,
  rows,
  base,
}: {
  title: string
  hint: string
  rows: Array<{ label: string; tokens: number; color: string }>
  base: number
}) {
  const safeBase = Math.max(base, 1)
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-[var(--color-text-heading)]">{title}</span>
        <span className="text-right text-[9.5px] text-[var(--color-text-disabled)]">{hint}</span>
      </div>
      <div className="mb-2.5 flex h-2 overflow-hidden rounded-full bg-[var(--color-border-light)]">
        {rows.map(row => (
          <div
            key={row.label}
            title={`${row.label}：${row.tokens.toLocaleString()} token`}
            style={{ width: `${row.tokens / safeBase * 100}%`, backgroundColor: row.color }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {rows.map(row => (
          <div key={row.label} className="flex min-w-0 items-center gap-1.5 text-[9.5px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-tertiary)]">{row.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--color-text-secondary)]">
              {fmtK(row.tokens)} · {(row.tokens / safeBase * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CcContextAnalysis(props: Props) {
  const [mcpConfig, setMcpConfig] = useState<CcMcpConfig>({ version: 1, servers: [] })
  const [backgroundTokens, setBackgroundTokens] = useState(0)
  const [analysis, setAnalysis] = useState<CcExactContextAnalysis | null>(null)
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const loadEstimateInputs = async () => {
      const [mcpResponse, sessionResponse] = await Promise.all([
        fetch('/api/cc-mcp', { cache: 'no-store' }),
        props.sessionId
          ? fetch(`/api/cc-turns?session_id=${encodeURIComponent(props.sessionId)}&limit=1`, { cache: 'no-store' })
          : Promise.resolve(null),
      ])
      if (mcpResponse.ok) {
        const payload = await mcpResponse.json() as { config?: CcMcpConfig }
        if (alive && payload.config) setMcpConfig(payload.config)
      }
      if (sessionResponse?.ok) {
        const payload = await sessionResponse.json() as {
          session?: {
            daily_review_enabled?: boolean
            daily_review_snapshot?: Array<{ content?: string }>
            handoff_snapshot?: HandoffSnapshot
          }
        }
        const session = payload.session
        const handoff = Number(session?.handoff_snapshot?.stats?.effective_estimated_tokens || 0)
        const daily = session?.daily_review_enabled
          ? estimateContextTokens((session.daily_review_snapshot || []).map(item => item.content || '').join('\n\n'))
          : 0
        if (alive) setBackgroundTokens(handoff + daily)
      }
    }
    void loadEstimateInputs().catch(() => undefined)
    return () => { alive = false }
  }, [props.sessionId])

  const estimated = useMemo(() => {
    const known = [
      { label: '提示词', tokens: estimateContextTokens(props.systemPromptText), color: COLORS[0] },
      { label: '换窗资料', tokens: backgroundTokens, color: COLORS[1] },
      { label: 'MCP 工具', tokens: estimateMcpConfigTokens(mcpConfig), color: COLORS[2] },
      { label: 'Web 工具', tokens: estimateWebToolTokens(props.web.searchEnabled, props.web.fetchEnabled), color: COLORS[3] },
      { label: '本窗对话', tokens: estimateContextTokens(props.conversationText), color: COLORS[4] },
    ]
    const knownTotal = sumTokens(known)
    const base = Math.max(props.actualTokens, knownTotal, 1)
    return {
      base,
      rows: [...known, {
        label: '未归因差额',
        tokens: Math.max(0, props.actualTokens - knownTotal),
        color: COLORS[5],
      }].filter(item => item.tokens > 0),
    }
  }, [backgroundTokens, mcpConfig, props.actualTokens, props.conversationText, props.systemPromptText, props.web.fetchEnabled, props.web.searchEnabled])

  const readExact = async (force: boolean) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/cc-context-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: props.sessionId,
          cred: props.cred,
          provider_id: props.providerId,
          force,
        }),
      })
      const payload = await response.json() as CcContextAnalysisResult
      if (!response.ok || !payload.ok || !payload.analysis) throw new Error(payload.error || '读取失败')
      setAnalysis(payload.analysis)
      setCached(payload.cached)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取失败')
    } finally {
      setLoading(false)
    }
  }

  const exactRows = (analysis?.categories || [])
    .filter(item => item.tokens > 0)
    .map((item, index) => ({ label: categoryLabel(item.name), tokens: item.tokens, color: COLORS[index % COLORS.length] }))
  const detailRows = analysis ? [
    ['系统提示词分段', sumTokens(analysis.systemPromptSections)],
    ['内置工具定义', sumTokens(analysis.systemTools)],
    ['MCP 工具定义', sumTokens(analysis.mcpTools)],
    ['记忆文件', sumTokens(analysis.memoryFiles)],
    ['Agents', sumTokens(analysis.agents)],
    ['Skills', analysis.skills?.tokens || 0],
    ['Slash Commands', analysis.slashCommands?.tokens || 0],
  ].filter(([, tokens]) => Number(tokens) > 0) as Array<[string, number]> : []
  const messageRows = analysis?.messageBreakdown ? [
    ['用户消息', analysis.messageBreakdown.userMessageTokens],
    ['助手消息', analysis.messageBreakdown.assistantMessageTokens],
    ['工具调用', analysis.messageBreakdown.toolCallTokens],
    ['工具结果', analysis.messageBreakdown.toolResultTokens],
    ['附件', analysis.messageBreakdown.attachmentTokens],
    ['重定向上下文', analysis.messageBreakdown.redirectedContextTokens],
    ['SDK 未归因', analysis.messageBreakdown.unattributedTokens],
  ].filter(([, tokens]) => Number(tokens) > 0) as Array<[string, number]> : []
  const disabledReason = props.busy
    ? '正在回复，结束后才能读取'
    : !props.live
      ? '当前原生会话不在线；请先在这个窗口发一条消息'
      : ''

  return (
    <div className="space-y-3">
      <section className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium text-[var(--color-text-heading)]">SDK 官方精确分析</div>
            <div className="mt-1 text-[9.5px] leading-relaxed text-[var(--color-text-disabled)]">
              手动调用 Agent SDK 的 Context 接口；可能产生额外 Pro/API 请求，不会自动刷新。
            </div>
          </div>
          <button
            type="button"
            disabled={loading || Boolean(disabledReason)}
            onClick={() => void readExact(Boolean(analysis))}
            className="shrink-0 rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10.5px] text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '读取中…' : analysis ? '重新读取' : '读取官方分析'}
          </button>
        </div>
        {disabledReason ? <div className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">{disabledReason}</div> : null}
        {error ? <div className="mt-2 text-[10px] text-[var(--color-primary)]">{error}</div> : null}
        {analysis ? (
          <div className="mt-3">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div className="text-[18px] tabular-nums text-[var(--color-text-heading)]">
                {fmtK(analysis.totalTokens)}
                <span className="ml-1 text-[10px] text-[var(--color-text-disabled)]">/ {fmtK(analysis.maxTokens)}</span>
              </div>
              <div className="text-right text-[9.5px] text-[var(--color-text-disabled)]">
                {cached ? '本进程缓存 · ' : ''}{analysis.model}<br />
                {new Date(analysis.updatedAt).toLocaleString('zh-HK', { hour12: false })}
              </div>
            </div>
            <TokenCard title="SDK 官方分类" hint="官方实际 token" rows={exactRows} base={analysis.totalTokens} />
            {detailRows.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 text-[10.5px] font-medium text-[var(--color-text-secondary)]">前缀明细</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {detailRows.map(([label, tokens]) => (
                    <div key={label} className="flex justify-between gap-2 text-[9.5px]">
                      <span className="text-[var(--color-text-tertiary)]">{label}</span>
                      <span className="tabular-nums text-[var(--color-text-secondary)]">{fmtK(tokens)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {messageRows.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 text-[10.5px] font-medium text-[var(--color-text-secondary)]">消息明细</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {messageRows.map(([label, tokens]) => (
                    <div key={label} className="flex justify-between gap-2 text-[9.5px]">
                      <span className="text-[var(--color-text-tertiary)]">{label}</span>
                      <span className="tabular-nums text-[var(--color-text-secondary)]">{fmtK(tokens)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <TokenCard
        title="产品模块预估"
        hint="模块为预估 · 总量为上次实际"
        rows={estimated.rows}
        base={estimated.base}
      />
      <div className="text-[9.5px] leading-relaxed text-[var(--color-text-disabled)]">
        “未归因差额”只是预估口径未覆盖的部分。要定位工具结果、附件、隐藏消息等真实来源，请以上面的 SDK 官方明细为准。
      </div>
    </div>
  )
}
