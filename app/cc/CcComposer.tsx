'use client'
import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import type { CcAttachment } from './types'

const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024
const MAX_STORED_BYTES = 2 * 1024 * 1024
const TARGET_BYTES = 900 * 1024
const MAX_EDGE = 2000
const MAX_ATTACHMENTS = 4
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob) throw new Error('浏览器无法压缩这张图片')
  return blob
}

async function prepareImage(file: File): Promise<File> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error(`${file.name} 不是支持的 JPEG、PNG 或 WebP 图片`)
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error(`${file.name} 超过 25MB`)
  const bitmap = await createImageBitmap(file)
  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    let quality = 0.9
    let blob: Blob | null = null
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法处理这张图片')
      context.drawImage(bitmap, 0, 0, width, height)
      blob = await canvasBlob(canvas, quality)
      if (blob.size <= TARGET_BYTES || (blob.size <= MAX_STORED_BYTES && quality <= 0.7)) break
      if (quality > 0.7) quality = Math.max(0.7, quality - 0.08)
      else scale *= 0.84
    }
    if (!blob || blob.size > MAX_STORED_BYTES) throw new Error(`${file.name} 压缩后仍超过 2MB，请裁剪后重试`)
    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() })
  } finally {
    bitmap.close()
  }
}

type Props = {
  sessionId: string
  value: string
  onChange: (v: string) => void
  onSubmit: (attachments: CcAttachment[]) => void
  onStop: () => void
  onClearAll?: () => Promise<boolean>
  onError?: (message: string) => void
  sending: boolean
  disabled?: boolean
  placeholder?: string
}

export default function CcComposer({
  sessionId,
  value,
  onChange,
  onSubmit,
  onStop,
  onClearAll,
  onError,
  sending,
  disabled,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<CcAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)

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

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const addFiles = async (files: File[]) => {
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) return onError?.('每轮最多添加 4 张图片')
    const selected = files.filter(file => file.type.startsWith('image/')).slice(0, remaining)
    if (selected.length === 0) return
    if (files.length > remaining) onError?.('每轮最多添加 4 张图片，多余图片没有加入')
    setUploading(true)
    try {
      const uploaded: CcAttachment[] = []
      for (const original of selected) {
        const prepared = await prepareImage(original)
        const form = new FormData()
        form.set('session_id', sessionId)
        form.set('image', prepared)
        const response = await fetch('/api/cc-attachments', { method: 'POST', body: form })
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>
        if (!response.ok || payload.ok !== true) throw new Error(String(payload.error || '图片上传失败'))
        const item = payload.attachment as Record<string, unknown>
        uploaded.push({
          id: String(item.id),
          sessionId,
          filename: String(item.filename || prepared.name),
          mimeType: String(item.mime_type || prepared.type) as CcAttachment['mimeType'],
          byteSize: Number(item.byte_size || prepared.size),
          sha256: String(item.sha256 || ''),
          previewUrl: `/api/cc-attachments/${encodeURIComponent(String(item.id))}?session_id=${encodeURIComponent(sessionId)}`,
        })
      }
      setAttachments(previous => [...previous, ...uploaded].slice(0, MAX_ATTACHMENTS))
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '图片处理失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeAttachment = async (attachment: CcAttachment) => {
    setAttachments(previous => previous.filter(item => item.id !== attachment.id))
    const response = await fetch(`/api/cc-attachments/${encodeURIComponent(attachment.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => null)
    if (!response?.ok) onError?.('图片没有从 Haven 清除，请稍后重试')
  }

  const submit = () => {
    if (uploading || (value.trim().length === 0 && attachments.length === 0)) return
    const sent = attachments
    setAttachments([])
    onSubmit(sent)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || disabled || sending || uploading) return
    const prefersTouch = typeof window !== 'undefined'
      && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
    if (prefersTouch || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled || sending) return
    void addFiles([...event.dataTransfer.files])
  }

  const hasContent = value.trim().length > 0 || attachments.length > 0

  return (
    <div
      className={`cc-composer relative flex flex-col px-3 py-2.5 ${dragging ? 'ring-2 ring-[var(--color-primary)]/30' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {attachments.length > 0 || uploading ? (
        <div className="mb-2 flex flex-wrap gap-2 pl-10">
          {attachments.map(attachment => (
            <div key={attachment.id} className="group relative h-16 w-16 overflow-hidden rounded-xl bg-[var(--color-surface-secondary)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- private authenticated blob route */}
              <img src={attachment.previewUrl} alt={attachment.filename} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`移除 ${attachment.filename}`}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-xs text-white"
                onClick={() => void removeAttachment(attachment)}
              >×</button>
            </div>
          ))}
          {uploading ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--color-surface-secondary)] text-[10px] text-[var(--color-text-tertiary)]">
              压缩上传中
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <div ref={menuRef} className="relative shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={event => void addFiles([...(event.target.files || [])])}
          />
          {menuOpen ? (
            <div className="absolute bottom-10 left-0 z-30 min-w-44 rounded-2xl border border-[var(--color-border-light)] bg-white p-1.5 shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
                onClick={() => { setMenuOpen(false); fileRef.current?.click() }}
              >
                <span aria-hidden="true">▧</span><span>图片</span>
              </button>
              {onClearAll ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"
                  onClick={async () => {
                    setMenuOpen(false)
                    if (!window.confirm('永久清除当前窗口里的全部图片？文字记录会保留。')) return
                    if (await onClearAll()) setAttachments([])
                  }}
                >
                  <span aria-hidden="true">×</span><span>清除本窗口图片</span>
                </button>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            aria-label="添加"
            aria-expanded={menuOpen}
            disabled={disabled || sending || uploading}
            onClick={() => setMenuOpen(open => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-40"
          >+</button>
        </div>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={placeholder || '说点什么'}
          className="flex-1 border-0 bg-transparent px-1 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={sending ? onStop : submit}
          disabled={disabled || uploading || (!sending && !hasContent)}
          aria-label={sending ? '停止生成' : uploading ? '图片上传中' : '发送'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-colors ${
            sending
              ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
              : hasContent && !uploading
                ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
                : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-disabled)]'
          }`}
        >
          {sending ? '■' : '↑'}
        </button>
      </div>
    </div>
  )
}
