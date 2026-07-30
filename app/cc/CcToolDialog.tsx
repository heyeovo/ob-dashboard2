'use client'
import { useEffect } from 'react'
import type { CcToolEvent } from './types'

// 工具调用详情弹窗。照 Polaris：消息上一个工具框，点开看输入参数和输出结果。
//
// MCP 日常工具会保留输出；Read / Grep / Bash 等工作工具故意不存大段结果。

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

function shortToolName(name: string) {
  if (name === 'WebSearch') return '网页搜索'
  if (name === 'WebFetch') return '读取网页'
  const parts = name.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : name
}

export default function CcToolDialog({
  tool,
  onClose,
}: {
  tool: CcToolEvent
  onClose: () => void
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const input = clip(pretty(tool.input))
  const result = tool.result ? clip(tool.result) : ''
  const error = tool.error ? clip(tool.error) : ''
  const status =
    tool.status === 'running'
      ? '调用中'
      : tool.status === 'error'
        ? '调用失败'
        : tool.status === 'denied'
          ? '已拒绝'
          : '已完成'

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-end justify-center sm:p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      <div className="cc-modal cc-tool-sheet relative flex max-h-[86vh] w-full max-w-2xl flex-col">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/10 sm:hidden" />
        <div className="flex items-start gap-3 border-b border-[var(--color-border-light)] px-5 py-4">
          <span className="cc-tool-wrench mt-0.5" aria-hidden="true">⌁</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-[var(--color-text-heading)]">
                调用工具：{shortToolName(tool.name)}
              </h2>
              <span className={`cc-tool-status ${tool.status || 'completed'}`}>{status}</span>
              {tool.durationMs != null && (
                <span className="text-[10px] tabular-nums text-[var(--color-text-disabled)]">
                  {(tool.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-disabled)]">
              {tool.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            关闭
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          <div className="cc-modal-label">输入参数</div>
          <pre className="cc-modal-pre">{input || '（无）'}</pre>

          <div className="cc-modal-label mt-5">{error ? '错误' : '输出结果'}</div>
          {error ? (
            <pre className="cc-modal-pre border-red-200 bg-red-50 text-red-700">{error}</pre>
          ) : result ? (
            <pre className="cc-modal-pre">{result}</pre>
          ) : tool.status === 'running' ? (
            <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
              工具正在执行，结果返回后会自动更新这里。
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
              本次没有保留输出。日常 MCP 工具会保存结果；文件、搜索和命令等工作工具
              仍只记录调用参数，避免把大段内容塞进聊天历史。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
