'use client'
import { useEffect } from 'react'
import type { CcToolEvent } from './types'

// 工具调用详情弹窗。照 Polaris：消息上一个工具框，点开看输入参数和输出结果。
//
// ⚠️ 输出结果这一版一定是空的：引擎层（/api/cc-chat）现在只把 tool_use 转成
// SSE 事件，SDK 回来的 tool_result 没接。接它要改引擎层，不在这一轮范围。
// 位置和空态文案已就位，接上之后不用改这里。

const MAX_CHARS = 4000

function pretty(input: unknown) {
  if (input == null) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function clip(text: string) {
  if (text.length <= MAX_CHARS) return text
  return `${text.slice(0, MAX_CHARS)}\n\n… 余下 ${text.length - MAX_CHARS} 字未显示`
}

export default function CcToolDialog({
  tool,
  onClose,
}: {
  tool: CcToolEvent
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const input = clip(pretty(tool.input))
  const result = tool.result ? clip(tool.result) : ''

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      <div className="cc-modal relative flex max-h-[82vh] w-full max-w-2xl flex-col">
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border-light)] px-5 py-3.5">
          <span className="cc-tool-dot" />
          <span className="font-mono text-[13px] text-[var(--color-text-heading)]">{tool.name}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            关闭
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          <div className="cc-modal-label">输入参数</div>
          <pre className="cc-modal-pre">{input || '（无）'}</pre>

          <div className="cc-modal-label mt-5">输出结果</div>
          {result ? (
            <pre className="cc-modal-pre">{result}</pre>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
              还没接。引擎层目前只把工具调用本身发给前端，结果没回传 —— 要在
              <span className="font-mono"> /api/cc-chat </span>
              里多接一个 tool_result 事件，是下一轮的活。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
