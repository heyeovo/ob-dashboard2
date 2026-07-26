'use client'
import Link from 'next/link'
import type { CcSessionStats } from './types'
import { EFFORT_OPTIONS, modelsFor, type CcUpstreamConfig, type CcUpstreamPick } from './upstream'

// 「本窗口设置」浮层（5.2）。右上角点开，只管**这一个对话**。
//
// 三档待遇，界面上必须写清楚，不然用户会以为点了就生效：
//   · 模型 / 力度 / 深度思考 —— 当场生效（换模型会把 prompt cache 清掉）
//   · 订阅 ↔ api 中转站、换哪个中转站 —— 子进程的环境变量，只有新对话能改
//   · 闲聊 / 工作 —— 同上，而且第一句话一发就定死（工具和系统提示都是启动参数）
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
  onClose: () => void
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
  onClose,
}: Props) {
  const models = modelsFor(upstream, pick.kind, pick.providerId)
  const recent = stats.recentCostUsd || []
  const recentSum = recent.reduce((a, b) => a + b, 0)
  // 订阅侧不按量计费，SDK 报的那个数字对用户没意义 —— 直接显示 $0（用户拍板的）。
  const subscription = pick.kind === 'subscription'

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="关闭本窗口设置" onClick={onClose} className="absolute inset-0" />
      <div className="cc-winset" role="dialog" aria-label="本窗口设置">
        <div className="cc-winset-title">本窗口设置</div>

        {/* ── 只读信息 ── */}
        <div className="cc-winset-row">
          <span>会话 id</span>
          <code className="cc-winset-mono">{sessionId || '—'}</code>
        </div>
        <div className="cc-winset-row">
          <span>轮次 / 字数</span>
          <span>
            {stats.turnCount} 轮 · {totalChars.toLocaleString()} 字
          </span>
        </div>
        <div className="cc-winset-row">
          <span>本轮花费</span>
          <span>{subscription ? '$0（订阅）' : fmtCost(recent[recent.length - 1] || 0)}</span>
        </div>
        <div className="cc-winset-row">
          <span>近 {Math.max(recent.length, 0)} 轮累计</span>
          <span>{subscription ? '$0（订阅）' : fmtCost(recentSum)}</span>
        </div>

        {/* ── 供应商：左订阅 / 右 api 中转站 ── */}
        <div className="cc-winset-sep" />
        <div className="cc-winset-label">供应商</div>
        <div className="cc-winset-seg">
          <button
            type="button"
            disabled={locked}
            className={pick.kind === 'subscription' ? 'is-on' : ''}
            onClick={() => onPick({ kind: 'subscription', providerId: '' })}
          >
            订阅
          </button>
          <button
            type="button"
            disabled={locked}
            className={pick.kind === 'api' ? 'is-on' : ''}
            onClick={() =>
              onPick({ kind: 'api', providerId: pick.providerId || upstream.providers[0]?.id || '' })
            }
          >
            api 中转站
          </button>
        </div>

        {pick.kind === 'api' ? (
          upstream.providers.length === 0 ? (
            <div className="cc-winset-empty">
              还没配中转站，去{' '}
              <Link href="/settings/upstream" className="underline">
                上游模型
              </Link>{' '}
              加一个
            </div>
          ) : (
            <select
              className="cc-winset-select"
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
          <div className="cc-winset-hint">换供应商要新建对话（这一窗的凭据启动时就定了）</div>
        ) : null}

        {/* ── 模型 / 力度 / 思考：能中途改 ── */}
        <div className="cc-winset-sep" />
        <div className="cc-winset-label">模型</div>
        {models.length === 0 ? (
          <div className="cc-winset-empty">
            这一侧还没填模型名，去{' '}
            <Link href="/settings/upstream" className="underline">
              上游模型
            </Link>{' '}
            填。现在用默认那个
          </div>
        ) : (
          <select
            className="cc-winset-select"
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

        <div className="cc-winset-label">力度</div>
        <div className="cc-winset-seg cc-winset-seg-5">
          {EFFORT_OPTIONS.map(o => (
            <button
              key={o.id}
              type="button"
              className={pick.effort === o.id ? 'is-on' : ''}
              onClick={() => onPick({ effort: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="cc-winset-row cc-winset-toggle"
          onClick={() => onPick({ thinking: !pick.thinking })}
        >
          <span>深度思考</span>
          <span className={pick.thinking ? 'cc-winset-dot is-on' : 'cc-winset-dot'}>
            {pick.thinking ? '开' : '关'}
          </span>
        </button>

        {note ? <div className="cc-winset-note">{note}</div> : null}

        {/* ── 换窗：5.3 接 handoff，这一版只有按钮 ── */}
        <div className="cc-winset-sep" />
        <button type="button" className="cc-winset-handoff" disabled title="换窗 handoff 还没接（5.3）">
          换窗（还没接）
        </button>
      </div>
    </div>
  )
}
