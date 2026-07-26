'use client'
import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

// 输入框。交互照 Polaris：
//   · 桌面端回车发送、Shift+回车换行
//   · 手机端（触屏）回车永远换行，只能点按钮发 —— 按 pointer:coarse 判断，不按屏幕宽度
//   · 中文输入法拼字中（isComposing）按回车不发送
//   · 单行起步，自动长高到 --chat-composer-max-h 后内部滚
//   · 生成中按钮变「停止」

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  sending: boolean
  disabled?: boolean
  placeholder?: string
}

export default function CcComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  sending,
  disabled,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    })
    return () => {
      if (frameRef.current === null) return
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [value])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || disabled || sending) return
    const prefersTouch =
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
    if (prefersTouch || e.nativeEvent.isComposing) return
    e.preventDefault()
    onSubmit()
  }

  const hasContent = value.trim().length > 0

  return (
    <div className="cc-composer flex items-end gap-2 px-3 py-2.5">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder || '说点什么'}
        className="flex-1 border-0 bg-transparent px-1 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] disabled:opacity-60"
      />
      <button
        type="button"
        onClick={sending ? onStop : onSubmit}
        disabled={disabled || (!sending && !hasContent)}
        aria-label={sending ? '停止生成' : '发送'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-colors ${
          sending
            ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
            : hasContent
              ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
              : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-disabled)]'
        }`}
      >
        {sending ? '■' : '↑'}
      </button>
    </div>
  )
}
