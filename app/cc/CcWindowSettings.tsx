'use client'
import Link from 'next/link'
import type { CcSessionStats } from './types'
import { EFFORT_OPTIONS, modelsFor, type CcUpstreamConfig, type CcUpstreamPick } from './upstream'

// 「本窗口设置」弹窗（5.2）。只管**这一个对话**。
//
// 壳跟协作者设置同一套（cc-modal-scrim + cc-modal），居中弹出。里面的样式用 Tailwind
// 直接写 —— 不新造 class，省得 globals.css 没重编译时整个散架。
//
// 三档待遇，界面上必须写清楚，不然用户会以为点了就生效：
//   · 模型 / 力度 / 深度思考 —— 当场生效（换模型会把 prompt cache 清掉）
//   · 订阅 ↔ api 中转站、换哪个中转站 —— 子进程的环境变量，只有新对话能改
//
// ⚠️ 中转站的 token 不下发到浏览器，这里只显示名字。要改去「上游模型」页。

function fmtCost(usd: number) {
  if (!usd) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

type Props = {
  sessionId: string
  stats: CcSessionStats
  /** 界面上这一窗的总字数（消息正文加起来） */
  totalChars: number
  upstream: CcUpstreamConfig
  pick: CcUpstreamPick
  onPick: (next: Partial<CcUpstreamPick>) => void
  /** 已经开口了：供应商那两个框只能看不能换 */
  locked: boolean
  note: string
  onHandoff: () => void
  onClose: () => void
}

/** 23400 → 23.4k */
function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

const ROW = 'flex items-center justify-between gap-3 py-1.5 text-[11.5px]'
const KEY = 'shrink-0 text-[var(--color-text-tertiary)]'
const VAL = 'truncate text-right text-[var(--color-text-secondary)]'
const LABEL = 'mb-1.5 text-[11px] text-[var(--color-text-disabled)]'
const HINT = 'mb-2 text-[10.5px] leading-relaxed text-[var(--color-text-disabled)]'
const SELECT =
  'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-[11.5px] text-[var(--color-text-secondary)]'

function seg(on: boolean) {
  return `flex-1 rounded-[var(--radius-md)] border px-2 py-1.5 text-[11.5px] transition-colors disabled:opacity-50 ${
    on
      ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-text-heading)]'
      : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]'
  }`
}

export default function CcWindowSettings({
  sessionId,
  stats,
  totalChars,
  upstream,
  pick,
  onPick,
  locked,
  note,
  onHandoff,
  onClose,
}: Props) {
  const models = modelsFor(upstream, pick.kind, pick.providerId)
  const recent = stats.recentCostUsd || []
  const recentSum = recent.reduce((a, b) => a + b, 0)
  // 订阅侧不按量计费，SDK 报的那个数字对用户没意义 —— 直接显示 $0（用户拍板的）。
  const subscription = pick.kind === 'subscription'

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      <div
        className="cc-modal relative flex max-h-[86vh] w-full max-w-sm flex-col"
        role="dialog"
        aria-label="本窗口设置"
      >
        {/* 头 */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--color-text-heading)]">本窗口设置</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">只影响这一个对话</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            关闭
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {/* ── 只读信息 ── */}
          <div className="mb-1">
            <div className={ROW}>
              <span className={KEY}>会话 id</span>
              <code className={`${VAL} font-mono text-[10.5px]`}>{sessionId || '—'}</code>
            </div>
            <div className={ROW}>
              <span className={KEY}>轮次 / 字数</span>
              <span className={VAL}>
                {stats.turnCount} 轮 · {totalChars.toLocaleString()} 字
              </span>
            </div>
            {/* 下面这两行手机端顶栏放不下，只在这里看得到 */}
            {stats.model ? (
              <div className={ROW}>
                <span className={KEY}>正在用</span>
                <span className={`${VAL} font-mono text-[10.5px]`}>{stats.model}</span>
              </div>
            ) : null}
            {stats.contextTokens > 0 ? (
              <div className={ROW}>
                <span className={KEY}>上下文</span>
                <span className={VAL}>
                  {fmtK(stats.contextTokens)}
                  {stats.contextMaxTokens > 0 ? ` / ${fmtK(stats.contextMaxTokens)}` : ''}
                </span>
              </div>
            ) : null}
            <div className={ROW}>
              <span className={KEY}>本轮花费</span>
              <span className={VAL}>
                {subscription ? '$0（订阅）' : fmtCost(recent[recent.length - 1] || 0)}
              </span>
            </div>
            <div className={ROW}>
              <span className={KEY}>近 {recent.length} 轮累计</span>
              <span className={VAL}>{subscription ? '$0（订阅）' : fmtCost(recentSum)}</span>
            </div>
          </div>

          {/* ── 供应商：左订阅 / 右 api 中转站 ── */}
          <div className="my-3.5 h-px bg-[var(--color-border-light)]" />
          <div className={LABEL}>供应商</div>
          <div className="mb-2 flex gap-1.5">
            <button
              type="button"
              disabled={locked}
              className={seg(pick.kind === 'subscription')}
              onClick={() => onPick({ kind: 'subscription', providerId: '' })}
            >
              订阅
            </button>
            <button
              type="button"
              disabled={locked}
              className={seg(pick.kind === 'api')}
              onClick={() =>
                onPick({ kind: 'api', providerId: pick.providerId || upstream.providers[0]?.id || '' })
              }
            >
              api 中转站
            </button>
          </div>

          {pick.kind === 'api' ? (
            upstream.providers.length === 0 ? (
              <div className={HINT}>
                还没配中转站，去{' '}
                <Link href="/settings/upstream" className="underline">
                  上游模型
                </Link>{' '}
                加一个
              </div>
            ) : (
              <select
                className={`${SELECT} mb-2`}
                disabled={locked}
                value={pick.providerId}
                onChange={e => onPick({ providerId: e.target.value })}
              >
                {upstream.providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )
          ) : null}

          {locked ? (
            <div className={HINT}>换供应商要新建对话（这一窗的凭据在启动时就定了）</div>
          ) : null}

          {/* ── 模型 / 力度 / 思考：能中途改 ── */}
          <div className="my-3.5 h-px bg-[var(--color-border-light)]" />
          <div className={LABEL}>模型</div>
          {models.length === 0 ? (
            <div className={HINT}>
              这一侧还没填模型名，去{' '}
              <Link href="/settings/upstream" className="underline">
                上游模型
              </Link>{' '}
              填。现在用默认那个
            </div>
          ) : (
            <select
              className={`${SELECT} mb-3`}
              value={pick.model}
              onChange={e => onPick({ model: e.target.value })}
            >
              {models.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}

          <div className={LABEL}>力度</div>
          <div className="mb-3 flex gap-1">
            {EFFORT_OPTIONS.map(o => (
              <button
                key={o.id}
                type="button"
                className={`${seg(pick.effort === o.id)} px-1 text-[11px]`}
                onClick={() => onPick({ effort: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`${ROW} w-full`}
            onClick={() => onPick({ thinking: !pick.thinking })}
          >
            <span className={KEY}>深度思考</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] ${
                pick.thinking
                  ? 'bg-[var(--color-primary-muted)] text-[var(--color-primary)]'
                  : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-disabled)]'
              }`}
            >
              {pick.thinking ? '开' : '关'}
            </span>
          </button>

          {note ? (
            <div className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-primary)]">{note}</div>
          ) : null}

          {/* ── 换窗 ── */}
          <div className="my-3.5 h-px bg-[var(--color-border-light)]" />
          <button
            type="button"
            onClick={onHandoff}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] py-2 text-[11.5px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text-heading)]"
          >
            换窗
          </button>
        </div>
      </div>
    </div>
  )
}
