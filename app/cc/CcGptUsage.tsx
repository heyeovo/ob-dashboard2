'use client'
import type { GptUsage } from './types'
import { gptTotalTokens } from './gptPresentation'

export function GptUsageTokenButton({ usage, onClick }: {
  usage: GptUsage | null | undefined; onClick: () => void
}) {
  const total = gptTotalTokens(usage)
  return <button type="button" onClick={onClick}
    className="ml-auto tabular-nums hover:text-[var(--color-text-secondary)]"
    title="本轮累计消耗；缓存包含在输入中，推理包含在输出中">
    {total == null ? 'Token 未取得' : `${total.toLocaleString()} tok`}
  </button>
}

export default function CcGptUsage({ usage, elapsedMs }: {
  usage: GptUsage | null | undefined; elapsedMs?: number | null
}) {
  const value = (number: number | null | undefined) => number == null ? '未取得' : number.toLocaleString()
  const num = 'font-medium tabular-nums text-[var(--color-text-secondary)]'
  return <div className="mt-1 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] px-3 py-2 text-left">
    <div className="mb-1.5 text-meta font-medium text-[var(--color-text-secondary)]">本轮累计消耗</div>
    <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2.5 gap-y-1 text-meta text-[var(--color-text-tertiary)]">
      <dt>↑ 输入</dt><dd className={num}>{value(usage?.input_tokens)}</dd>
      <dt>↓ 输出</dt><dd className={num}>{value(usage?.output_tokens)}</dd>
      <dt>缓存（输入内）</dt><dd className={num}>{value(usage?.cached_tokens)}</dd>
      <dt>推理（输出内）</dt><dd className={num}>{value(usage?.reasoning_tokens)}</dd>
      <dt>时长</dt><dd className={num}>{elapsedMs == null ? '未取得' : `${(elapsedMs / 1000).toFixed(1)}s`}</dd>
    </dl>
  </div>
}
