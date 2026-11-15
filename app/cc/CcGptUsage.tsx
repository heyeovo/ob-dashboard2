'use client'
import { useState } from 'react'
import type { GptUsage } from './types'

export default function CcGptUsage({ usage }: { usage: GptUsage | null | undefined }) {
  const [open, setOpen] = useState(false)
  const value = (number: number | null | undefined) => number == null ? '未知' : number.toLocaleString()
  return <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 text-left">
      GPT 用量：{usage?.total_tokens == null ? '未知' : `${usage.total_tokens.toLocaleString()} tok`}
    </button>
    {open ? <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
      <dt>输入</dt><dd>{value(usage?.input_tokens)}</dd>
      <dt>输出</dt><dd>{value(usage?.output_tokens)}</dd>
      <dt>缓存输入</dt><dd>{value(usage?.cached_tokens)}</dd>
      <dt>推理</dt><dd>{value(usage?.reasoning_tokens)}</dd>
    </dl> : null}
  </div>
}
