'use client'

import { useState } from 'react'
import Stat from '../components/Stat'
import { compareGptAudits, sortGptAuditTurns, type GptAuditData, type GptAuditTurn } from '../lib/gptSubscription/auditTypes'

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '未提供'
const label = (turn: GptAuditTurn) => `${turn.round_id === null ? '未关联轮次' : `第 ${turn.round_id} 轮`} · ${turn.created_at} · ${turn.request_id}`
const state = (turn: GptAuditTurn, readError: string | null) => !turn.evidence ? readError ? '记录读取失败' : '未记录' : turn.evidence.acknowledged_at ? '上游已回执' : turn.evidence.sending_at ? '已开始发送，是否送达未知' : '发送前已记录，尚无发送证据'

export default function GptContextAudit({ initial, onRefresh }: { initial: GptAuditData; onRefresh: () => void }) {
  const [data, setData] = useState(initial)
  const [selected, setSelected] = useState(initial.turns.at(-1)?.request_id || '')
  const [previous, setPrevious] = useState(initial.turns.at(-2)?.request_id || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const current = data.turns.find(turn => turn.request_id === selected)
  const old = data.turns.find(turn => turn.request_id === previous)
  const usage = current?.usage
  async function older() {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ session_id: data.session_id, engine: 'gpt_subscription',
        before_cursor: String(data.before_cursor || 0), before_turn_id: String(data.before_turn_id || 0) })
      const response = await fetch(`/api/cc-context-audit?${params}`, { cache: 'no-store' })
      const page = await response.json() as GptAuditData
      if (!response.ok || !page.ok) throw new Error('较早记录读取失败')
      setData(oldData => {
        const merged = new Map<string, GptAuditTurn>()
        for (const turn of [...page.turns, ...oldData.turns]) {
          const existing = merged.get(turn.request_id)
          merged.set(turn.request_id, existing ? { ...existing, ...turn,
            round_id: turn.round_id ?? existing.round_id, evidence: turn.evidence || existing.evidence,
            usage: turn.usage || existing.usage } : turn)
        }
        return { ...page, records_error: oldData.records_error || page.records_error,
          turns: [...merged.values()].sort(sortGptAuditTurns) }
      })
    } catch { setError('较早记录读取失败，请重试。') } finally { setLoading(false) }
  }
  return <div className="space-y-4 text-sm text-[var(--color-text-secondary)]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>{data.title} · GPT 上下文审计 · 当前配置 revision {data.context_revision}</span>
      <button type="button" onClick={onRefresh} className="min-h-11 rounded-lg border border-[var(--color-border)] px-3">重新读取</button>
    </div>
    <p className="text-meta text-[var(--color-text-tertiary)]">当前配置版本不是过去请求的快照。这里只显示保存的指纹与元数据，不重建旧请求正文。</p>
    {data.records_error || error ? <p role="alert" className="rounded-lg bg-[var(--color-pending-bg)] p-3 text-[var(--color-pending)]">{error || data.records_error}</p> : null}
    {!data.turns.length ? <p>还没有可读的 GPT 轮次或发送前记录。</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0">比较起点<select aria-label="比较起点" value={previous} onChange={e => setPrevious(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-base">
          <option value="">选择一轮</option>{data.turns.map(turn => <option key={turn.request_id} value={turn.request_id}>{label(turn)}</option>)}
        </select></label>
        <label className="min-w-0">比较终点<select aria-label="比较终点" value={selected} onChange={e => setSelected(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-base">
          {data.turns.map(turn => <option key={turn.request_id} value={turn.request_id}>{label(turn)}</option>)}
        </select></label>
      </div>
      <p className="rounded-lg bg-[var(--color-surface-secondary)] p-3">{compareGptAudits(old?.evidence?.snapshot, current?.evidence?.snapshot)}</p>
      {current ? <>
        <p>{state(current, data.records_error)} · {current.model} · {current.evidence?.outcome || '结果未记录'}</p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="上游真实输入" value={number(usage?.input_tokens)} />
          <Stat label="真实缓存 · 输入的子集" value={number(usage?.cached_tokens)} />
          <Stat label="上游真实输出" value={number(usage?.output_tokens)} />
          <Stat label="上下文估算 · 非真实 token" value={number(current.context.input_tokens_estimated)} />
        </div>
        <p className="text-meta">比较起点：输入 {number(old?.usage?.input_tokens)} · 缓存 {number(old?.usage?.cached_tokens)}。终点历史纳入 {number(current.context.included_history_rounds)} 轮，省略 {number(current.context.omitted_history_rounds)} 轮；背景 revision {number(current.context.context_revision)}。模型真实上限未知。</p>
        {current.evidence ? <details className="rounded-lg border border-[var(--color-border)] p-3">
          <summary className="min-h-11 cursor-pointer">查看发送证据与分段指纹</summary>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-meta">{JSON.stringify(current.evidence, null, 2)}</pre>
        </details> : <p>此轮没有可用的发送前指纹；已有真实用量仍可查看，不能补造旧请求。</p>}
      </> : null}
    </>}
    {data.before_cursor || data.has_more_turns ? <button type="button" onClick={() => void older()} disabled={loading} className="min-h-11 rounded-lg border border-[var(--color-border)] px-3">{loading ? '正在读取…' : '读取较早轮次'}</button> : null}
    <p className="text-meta leading-5 text-[var(--color-text-tertiary)]">消息从第一条开始按角色与正文比较；本轮时间注入在下一轮恢复为历史正文时，也可能成为首个差异。指纹相同只能证明记录范围内内容一致，不能证明上游缓存路由、保留时间或必然命中。</p>
  </div>
}
