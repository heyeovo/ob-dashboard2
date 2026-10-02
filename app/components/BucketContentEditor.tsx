'use client'
import { useLayoutEffect, useRef } from 'react'

export function editorGeometry(fontSize: number, contentHeight: number, availableHeight: number) {
  // iPhone inputs must be at least 16 CSS px to avoid focus zoom. Scale only
  // the input's rendering so its visual type and wrapping match the reader.
  const inputFontSize = Math.max(16, fontSize)
  const scale = fontSize / inputFontSize
  const height = Math.min(contentHeight * scale, availableHeight)
  return { inputFontSize, scale, height, inputHeight: height / scale, widthPercent: 100 / scale }
}

export function editorAvailableHeight(fontSize: number, viewportHeight: number, viewportBottom: number, top: number) {
  return Math.max(fontSize * 1.85 * 3, Math.min(viewportHeight * .5, viewportBottom - top - 96))
}

export default function BucketContentEditor({ value, onChange }: {
  value: string; onChange: (value: string) => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const input = inputRef.current
    if (!frame || !input) return
    const fit = () => {
      const fontSize = Number.parseFloat(getComputedStyle(frame).fontSize)
      const inputFontSize = Math.max(16, fontSize)
      const scale = fontSize / inputFontSize
      const scrollTop = input.scrollTop
      input.style.fontSize = `${inputFontSize}px`
      input.style.width = `${100 / scale}%`
      input.style.transform = `scale(${scale})`
      input.style.height = '0px'
      const viewport = window.visualViewport
      const viewportHeight = viewport?.height ?? window.innerHeight
      const viewportBottom = (viewport?.offsetTop ?? 0) + viewportHeight
      // Leave space for save/cancel and the drawer's controls. Short content
      // keeps its natural height; a long editor scrolls inside this frame.
      const available = editorAvailableHeight(fontSize, viewportHeight, viewportBottom, frame.getBoundingClientRect().top)
      const geometry = editorGeometry(fontSize, input.scrollHeight, available)
      input.style.height = `${geometry.inputHeight}px`
      frame.style.height = `${geometry.height}px`
      input.scrollTop = scrollTop
    }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(frame)
    window.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('scroll', fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('scroll', fit)
    }
  }, [value])

  return <div ref={frameRef} className="bucket-editor-frame text-md">
    <textarea ref={inputRef} aria-label="记忆正文" className="bucket-content-editor" rows={1} value={value} onChange={event => onChange(event.target.value)} />
  </div>
}
