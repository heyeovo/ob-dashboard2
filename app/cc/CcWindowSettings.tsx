'use client'
import Link from 'next/link'
import type { CcEngine, CcProUsage, CcSessionStats } from './types'
import { MODE_HINT, MODE_LABEL, type CcMode } from '@/app/lib/ccModes'
import {
  EFFORT_OPTIONS,
  modelLabel,
  modelsFor,
  type CcUpstreamConfig,
  type CcUpstreamPick,
} from './upstream'
import type { CcWebSettings } from './webSettings'

// 「本窗口设置」弹窗（5.2）。只管**这一个对话**。
//
// 壳跟协作者设置同一套（cc-modal-scrim + cc-modal），居中弹出。里面的样式用 Tailwind
// 直接写 —— 不新造 class，省得 globals.css 没重编译时整个散架。
//
// 三档待遇，界面上必须写清楚，不然用户会以为点了就生效：
//   · 模型 / 力度 / 深度思考 —— 当场生效（换模型会把 prompt cache 清掉）
//   · cc 的订阅 / 中转站 —— 同一 Dashboard 窗口内切换独立 Claude session
//   · selfhost 的中转站 —— 每轮重新直连，保存到 Haven 后下一句生效
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
  /** 最后一轮实际使用的上游；没有已完成轮次时由页面回退到当前选择。 */
  activeProvider: string
  activeModel: string
  /** 最后一轮实际上下文；cc 没有历史元数据时由页面回退到进程 stats。 */
  contextTokens: number
  contextMaxTokens: number
  upstream: CcUpstreamConfig
  pick: CcUpstreamPick
  proUsage: CcProUsage | null
  onRefreshProUsage: () => void
  onPick: (next: Partial<CcUpstreamPick>) => void
  web: CcWebSettings
  onWebChange: (next: Partial<CcWebSettings>) => void
  onSaveWebDefaults: () => void
  webSaving: boolean
  engine: CcEngine
  mode: CcMode
  onModeChange: (next: CcMode) => void
  modeLocked: boolean
  providerLocked: boolean
  webLocked: boolean
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
  activeProvider,
  activeModel,
  contextTokens,
  contextMaxTokens,
  upstream,
  pick,
  proUsage,
  onRefreshProUsage,
  onPick,
  web,
  onWebChange,
  onSaveWebDefaults,
  webSaving,
  engine,
  mode,
  onModeChange,
  modeLocked,
  providerLocked,
  webLocked,
  note,
  onHandoff,
  onClose,
}: Props) {
  const models = modelsFor(upstream, pick.kind, pick.providerId)
  const shownActiveModel = modelLabel(activeModel, models, pick.kind)
  const activeUpstream = [activeProvider, shownActiveModel].filter(Boolean).join(' · ')
  const recent = stats.recentCostUsd || []
  const recentSum = recent.reduce((a, b) => a + b, 0)
  // 订阅侧不按量计费，SDK 报的那个数字对用户没意义 —— 直接显示 $0（用户拍板的）。
  const subscription = pick.kind === 'subscription'
  const usageRows = [
    ['5 小时', proUsage?.fiveHour],
    ['本周', proUsage?.sevenDay],
  ] as const

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
            {activeUpstream ? (
              <div className={ROW}>
                <span className={KEY}>正在用</span>
                <span className={`${VAL} font-mono text-[10.5px]`} title={activeUpstream}>
                  {activeUpstream}
                </span>
              </div>
            ) : null}
            {contextTokens > 0 ? (
              <div className={ROW}>
                <span className={KEY}>上下文</span>
                <span className={VAL}>
                  {fmtK(contextTokens)}
                  {contextMaxTokens > 0 ? ` / ${fmtK(contextMaxTokens)}` : ''}
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

          {engine === 'cc' ? (
            <>
              <div className="my-3.5 h-px bg-[var(--color-border-light)]" />
              <div className={LABEL}>模式</div>
              <div className="mb-2 flex gap-1.5">
                {(['chat', 'work'] as const).map(nextMode => (
                  <button
                    key={nextMode}
                    type="button"
                    disabled={modeLocked}
                    className={seg(mode === nextMode)}
                    onClick={() => onModeChange(nextMode)}
                  >
                    {MODE_LABEL[nextMode]}
                  </button>
                ))}
              </div>
              <div className={HINT}>
                {modeLocked ? '这个窗口已用过 cc；如需换模式，请新建窗口。' : MODE_HINT[mode]}
              </div>
            </>
          ) : null}

          {/* ── 供应商：左订阅 / 右 api 中转站 ── */}
          <div className="my-3.5 h-px bg-[var(--color-border-light)]" />
          <div className={LABEL}>供应商</div>
          <div className="mb-2 flex gap-1.5">
            <button
              type="button"
              disabled={providerLocked || engine === 'selfhost'}
              className={seg(pick.kind === 'subscription')}
              onClick={() => onPick({ kind: 'subscription', providerId: '' })}
            >
              订阅
            </button>
            <button
              type="button"
              disabled={providerLocked}
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
                disabled={providerLocked}
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

          {providerLocked ? (
            <div className={HINT}>正在回复，结束后才能切换线路。</div>
          ) : engine === 'selfhost' ? (
            <div className={HINT}>自建引擎每轮重新连接；切换中转站后，下一句话立即使用新选择。</div>
          ) : (
            <div className={HINT}>可在同一窗口切换 Pro / API；目标线路会恢复自己的 Claude 会话，并补入中间文字对话。</div>
          )}

          {engine === 'cc' && subscription ? (
            <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={KEY}>Pro 额度</span>
                <button type="button" onClick={onRefreshProUsage} className="text-[10.5px] text-[var(--color-primary)]">
                  刷新
                </button>
              </div>
              {proUsage?.available ? usageRows.map(([label, window]) => {
                if (!window || window.utilization == null) {
                  return <div key={label} className={HINT}>{label}额度暂不可用</div>
                }
                const used = Math.max(0, Math.min(100, Number(window?.utilization || 0)))
                const remaining = Math.max(0, 100 - used)
                const reset = window?.resetsAt
                  ? new Date(window.resetsAt).toLocaleString('zh-HK', {
                      timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })
                  : '未知'
                return (
                  <div key={label} className="mb-2 last:mb-0">
                    <div className="mb-1 flex justify-between text-[10.5px] text-[var(--color-text-secondary)]">
                      <span>{label}</span><span>剩余 {remaining.toFixed(0)}% · {reset} 重置</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border-light)]">
                      <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${remaining}%` }} />
                    </div>
                  </div>
                )
              }) : (
                <div className={HINT}>{proUsage?.note || '使用 Pro 线路完成一轮后可读取额度'}</div>
              )}
              <div className="mt-1 text-[9.5px] text-[var(--color-text-disabled)]">
                {proUsage?.stale ? '上次读取值 · ' : ''}Agent SDK 实验性数据，接口变化时会自动显示不可用
              </div>
            </div>
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

          {/* ── 联网工具：首句后锁定；默认值由 Haven 保存 ── */}
          <div className="my-3.5 h-px bg-[var(--color-border-light)]" />
          <div className={LABEL}>联网工具</div>
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={webLocked}
              className={seg(web.searchEnabled)}
              onClick={() => onWebChange({ searchEnabled: !web.searchEnabled })}
            >
              Web Search · {web.searchEnabled ? '开' : '关'}
            </button>
            <button
              type="button"
              disabled={webLocked}
              className={seg(web.fetchEnabled)}
              onClick={() => onWebChange({ fetchEnabled: !web.fetchEnabled })}
            >
              Web Fetch · {web.fetchEnabled ? '开' : '关'}
            </button>
          </div>
          {webLocked ? (
            <div className={HINT}>联网工具在会话启动时确定；这一窗已经开口，只能新建或换窗后调整</div>
          ) : null}

          <details className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] px-3 py-2.5">
            <summary className="cursor-pointer text-[11.5px] text-[var(--color-text-secondary)]">
              高级选项
            </summary>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className={LABEL}>每轮最多 Search 次数</span>
                <select
                  className={SELECT}
                  disabled={webLocked || !web.searchEnabled}
                  value={web.maxSearchesPerTurn}
                  onChange={e => onWebChange({ maxSearchesPerTurn: Number(e.target.value) })}
                >
                  {[1, 2, 3, 5, 8, 10].map(value => (
                    <option key={value} value={value}>{value} 次</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={LABEL}>每轮最多 Fetch 网页数</span>
                <select
                  className={SELECT}
                  disabled={webLocked || !web.fetchEnabled}
                  value={web.maxFetchesPerTurn}
                  onChange={e => onWebChange({ maxFetchesPerTurn: Number(e.target.value) })}
                >
                  {[1, 2, 3, 5, 8, 10].map(value => (
                    <option key={value} value={value}>{value} 个</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={LABEL}>单页内容目标上限</span>
                <select
                  className={SELECT}
                  disabled={webLocked || !web.fetchEnabled}
                  value={web.fetchTargetTokens}
                  onChange={e => onWebChange({ fetchTargetTokens: Number(e.target.value) })}
                >
                  {[1000, 2000, 4000, 8000, 16000].map(value => (
                    <option key={value} value={value}>约 {fmtK(value)} tokens</option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] leading-relaxed text-[var(--color-text-disabled)]">
                  这是附加给 Web Fetch 的目标说明，不是 SDK 硬上限；历史保存会另外硬截断。
                </span>
              </label>

              <label className="block">
                <span className={LABEL}>最多展示来源数</span>
                <select
                  className={SELECT}
                  disabled={webLocked || !web.searchEnabled}
                  value={web.maxDisplayedSources}
                  onChange={e => onWebChange({ maxDisplayedSources: Number(e.target.value) })}
                >
                  {[1, 3, 5, 10, 20].map(value => (
                    <option key={value} value={value}>{value} 条</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={LABEL}>域名范围</span>
                <select
                  className={`${SELECT} mb-2`}
                  disabled={webLocked}
                  value={web.domainMode}
                  onChange={e =>
                    onWebChange({
                      domainMode: e.target.value as CcWebSettings['domainMode'],
                    })
                  }
                >
                  <option value="all">不限制</option>
                  <option value="allow">只允许以下域名</option>
                  <option value="block">禁止以下域名</option>
                </select>
                {web.domainMode !== 'all' ? (
                  <textarea
                    className={`${SELECT} min-h-20 resize-y font-mono text-[10.5px]`}
                    disabled={webLocked}
                    value={web.domains.join('\n')}
                    placeholder={'example.com\ndocs.example.org'}
                    onChange={e =>
                      onWebChange({
                        domains: e.target.value.split(/[\n,]+/).map(item => item.trim()),
                      })
                    }
                  />
                ) : null}
                <span className="mt-1 block text-[10px] leading-relaxed text-[var(--color-text-disabled)]">
                  只填域名，不填 https://；同时约束 Search 和 Fetch。
                </span>
              </label>
            </div>
          </details>

          <button
            type="button"
            disabled={webSaving}
            onClick={onSaveWebDefaults}
            className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] py-2 text-[11.5px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]/40 disabled:opacity-50"
          >
            {webSaving ? '保存中…' : '保存为新窗口默认'}
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
