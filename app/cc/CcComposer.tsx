'use client'
import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { isSupportedDocument, parseDocument } from '@/app/lib/attachments/documentParser'
import type { CcAttachment } from './types'
import type { CcPromptModule } from './persona'

const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024
const MAX_STORED_BYTES = 2 * 1024 * 1024
const TARGET_BYTES = 900 * 1024
const MAX_EDGE = 2000
const MAX_ATTACHMENTS = 4
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const DOCUMENT_ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.csv'

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob) throw new Error('浏览器无法压缩这张图片')
  return blob
}

async function prepareImage(file: File): Promise<File> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error(`${file.name} 不是支持的 JPEG、PNG 或 WebP 图片`)
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

function CameraIcon() {
  return <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 6.5 9.4 4.5h5.2L16 6.5h2.5A2.5 2.5 0 0 1 21 9v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V9a2.5 2.5 0 0 1 2.5-2.5H8Z"/><circle cx="12" cy="13" r="3.5"/></svg>
}

function PhotoIcon() {
  return <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8" cy="9" r="1.5"/><path d="m5 18 4.5-4.5 3 3 2.5-2.5 4 4"/></svg>
}

function FileIcon({ small = false }: { small?: boolean }) {
  return <svg viewBox="0 0 24 24" className={small ? 'size-5' : 'size-7'} fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8.5 12.5 14 7a3 3 0 0 1 4.2 4.2l-7.4 7.4a5 5 0 0 1-7.1-7.1l7.6-7.6"/></svg>
}

function LayersIcon() {
  return <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>
}

type Props = {
  sessionId: string
  value: string
  onChange: (v: string) => void
  onSubmit: (attachments: CcAttachment[]) => void
  onStop: () => void
  onClearKind?: (kind: 'image' | 'file') => Promise<boolean>
  activeImageCount?: number
  activeFileCount?: number
  onError?: (message: string) => void
  promptModules?: CcPromptModule[]
  promptModuleOverrides?: Record<string, boolean>
  promptModulesSaving?: boolean
  onPromptModuleToggle?: (moduleId: string, defaultEnabled: boolean, enabled: boolean) => Promise<boolean>
  sending: boolean
  disabled?: boolean
  placeholder?: string
  forwardedBlock?: { title: string; lines: string[] } | null
  onClearForward?: () => void
}

export default function CcComposer({
  sessionId,
  value,
  onChange,
  onSubmit,
  onStop,
  onClearKind,
  activeImageCount = 0,
  activeFileCount = 0,
  onError,
  promptModules = [],
  promptModuleOverrides = {},
  promptModulesSaving = false,
  onPromptModuleToggle,
  sending,
  disabled,
  placeholder,
  forwardedBlock,
  onClearForward,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const documentRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuView, setMenuView] = useState<'main' | 'prompts'>('main')
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
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [value])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const uploadImages = async (files: File[], remaining: number) => {
    const selected = files.filter(file => file.type.startsWith('image/')).slice(0, remaining)
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
        id: String(item.id), sessionId, filename: String(item.filename || prepared.name), kind: 'image',
        mimeType: String(item.mime_type || prepared.type), byteSize: Number(item.byte_size || prepared.size),
        sha256: String(item.sha256 || ''),
        previewUrl: `/api/cc-attachments/${encodeURIComponent(String(item.id))}?session_id=${encodeURIComponent(sessionId)}`,
      })
    }
    return uploaded
  }

  const uploadDocuments = async (files: File[], remaining: number) => {
    const selected = files.filter(isSupportedDocument).slice(0, remaining)
    const uploaded: CcAttachment[] = []
    for (const original of selected) {
      const parsed = await parseDocument(original)
      const form = new FormData()
      form.set('session_id', sessionId)
      form.set('file', original)
      form.set('text_content', parsed.textContent)
      form.set('text_truncated', parsed.truncated ? '1' : '0')
      const response = await fetch('/api/cc-attachments', { method: 'POST', body: form })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || payload.ok !== true) throw new Error(String(payload.error || '文件上传失败'))
      const item = payload.attachment as Record<string, unknown>
      uploaded.push({
        id: String(item.id), sessionId, filename: String(item.filename || original.name), kind: 'file',
        mimeType: String(item.mime_type || parsed.mimeType), byteSize: Number(item.byte_size || original.size),
        sha256: String(item.sha256 || ''), textChars: Number(item.text_chars || parsed.textContent.length),
        textTruncated: item.text_truncated === true,
        previewUrl: `/api/cc-attachments/${encodeURIComponent(String(item.id))}?session_id=${encodeURIComponent(sessionId)}`,
      })
    }
    return uploaded
  }

  const addFiles = async (files: File[]) => {
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) return onError?.('每轮图片和文件合计最多 4 个')
    const supported = files.filter(file => file.type.startsWith('image/') || isSupportedDocument(file))
    if (!supported.length) return onError?.('只支持 JPEG、PNG、WebP、PDF、DOCX、MD、TXT、CSV')
    if (supported.length > remaining) onError?.('每轮图片和文件合计最多 4 个，多余内容没有加入')
    setUploading(true)
    try {
      const limited = supported.slice(0, remaining)
      const uploaded: CcAttachment[] = []
      for (const file of limited) {
        const next = file.type.startsWith('image/')
          ? await uploadImages([file], 1)
          : await uploadDocuments([file], 1)
        uploaded.push(...next)
      }
      setAttachments(previous => [...previous, ...uploaded].slice(0, MAX_ATTACHMENTS))
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '附件处理失败')
    } finally {
      setUploading(false)
      for (const input of [cameraRef.current, photoRef.current, documentRef.current]) {
        if (input) input.value = ''
      }
    }
  }

  const removeAttachment = async (attachment: CcAttachment) => {
    setAttachments(previous => previous.filter(item => item.id !== attachment.id))
    const response = await fetch(`/api/cc-attachments/${encodeURIComponent(attachment.id)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => null)
    if (!response?.ok) onError?.(`${attachment.kind === 'image' ? '图片' : '文件'}没有从 Haven 清除，请稍后重试`)
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
    const files = [...event.clipboardData.files]
    if (!files.some(file => file.type.startsWith('image/') || isSupportedDocument(file))) return
    event.preventDefault()
    void addFiles(files)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled && !sending) void addFiles([...event.dataTransfer.files])
  }

  const clearKind = async (kind: 'image' | 'file') => {
    const count = kind === 'image' ? activeImageCount : activeFileCount
    const label = kind === 'image' ? '图片' : '文件'
    setMenuOpen(false)
    if (count <= 0) return
    if (!window.confirm(`永久清除当前窗口中的 ${count} 个${label}？文字消息会保留。`)) return
    if (await onClearKind?.(kind)) {
      setAttachments(previous => previous.filter(item => item.kind !== kind))
    }
  }

  const hasContent = value.trim().length > 0 || attachments.length > 0
  const activePromptModuleCount = promptModules.filter(module =>
    promptModuleOverrides[module.id] ?? module.enabledByDefault,
  ).length

  return (
    <div
      className={`cc-composer relative flex flex-col px-3 py-2.5 ${dragging ? 'ring-2 ring-[var(--color-primary)]/30' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {forwardedBlock && forwardedBlock.lines.length > 0 ? (
        <div className="mb-2 ml-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
              转发 · {forwardedBlock.title} · {forwardedBlock.lines.length} 条
            </span>
            <button type="button" onClick={onClearForward} className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]" aria-label="移除转发">×</button>
          </div>
          <div className="mt-1 max-h-24 overflow-y-auto text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
            {forwardedBlock.lines.slice(0, 3).map((line, i) => (
              <div key={i} className="truncate">{line}</div>
            ))}
            {forwardedBlock.lines.length > 3 ? <div>…还有 {forwardedBlock.lines.length - 3} 条</div> : null}
          </div>
        </div>
      ) : null}
      {attachments.length > 0 || uploading ? (
        <div className="mb-2 flex flex-wrap gap-2 pl-10">
          {attachments.map(attachment => (
            <div key={attachment.id} className="group relative">
              {attachment.kind === 'image' ? (
                <div className="h-16 w-16 overflow-hidden rounded-xl bg-[var(--color-surface-secondary)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private authenticated blob route */}
                  <img src={attachment.previewUrl} alt={attachment.filename} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-16 w-44 items-center gap-2 rounded-xl bg-[var(--color-surface-secondary)] px-3 text-[var(--color-text-secondary)]">
                  <FileIcon small />
                  <div className="min-w-0"><div className="truncate text-xs font-medium">{attachment.filename}</div><div className="text-[10px] text-[var(--color-text-tertiary)]">{attachment.textTruncated ? '已截断' : '已读取'}</div></div>
                </div>
              )}
              <button type="button" aria-label={`移除 ${attachment.filename}`} className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-xs text-white" onClick={() => void removeAttachment(attachment)}>×</button>
            </div>
          ))}
          {uploading ? <div className="flex h-16 min-w-20 items-center justify-center rounded-xl bg-[var(--color-surface-secondary)] px-3 text-[10px] text-[var(--color-text-tertiary)]">解析上传中</div> : null}
        </div>
      ) : null}

      <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={event => void addFiles([...(event.target.files || [])])} />
      <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={event => void addFiles([...(event.target.files || [])])} />
      <input ref={documentRef} type="file" accept={DOCUMENT_ACCEPT} multiple className="hidden" onChange={event => void addFiles([...(event.target.files || [])])} />

      {menuOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45" role="presentation" onPointerDown={() => setMenuOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="添加内容" className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-xl rounded-t-[28px] bg-white px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-2 shadow-2xl" onPointerDown={event => event.stopPropagation()}>
            <div className="mx-auto mb-5 h-1.5 w-14 rounded-full bg-black/15" />
            {menuView === 'main' ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <button type="button" className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--color-surface-secondary)] text-sm text-[var(--color-text-primary)]" onClick={() => { setMenuOpen(false); cameraRef.current?.click() }}>
                    <CameraIcon /><span>拍照</span>
                  </button>
                  <button type="button" className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--color-surface-secondary)] text-sm text-[var(--color-text-primary)]" onClick={() => { setMenuOpen(false); photoRef.current?.click() }}>
                    <PhotoIcon /><span>照片</span>
                  </button>
                  <button type="button" className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--color-surface-secondary)] text-sm text-[var(--color-text-primary)]" onClick={() => { setMenuOpen(false); documentRef.current?.click() }}>
                    <FileIcon /><span>上传文件</span>
                  </button>
                </div>
                <div className="mt-5 border-t border-[var(--color-border-light)] pt-2">
                  <button type="button" className="flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left text-sm text-[var(--color-text-primary)]" onClick={() => setMenuView('prompts')}>
                    <span className="flex items-center gap-3"><LayersIcon />提示词模块</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">{activePromptModuleCount}/{promptModules.length} 已开启 ›</span>
                  </button>
                  <button type="button" disabled={activeImageCount <= 0} className="flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left text-sm text-[var(--color-text-primary)] disabled:opacity-35" onClick={() => void clearKind('image')}><span>清除本窗口图片</span><span className="text-xs text-[var(--color-text-tertiary)]">{activeImageCount} 张 ›</span></button>
                  <button type="button" disabled={activeFileCount <= 0} className="flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left text-sm text-[var(--color-text-primary)] disabled:opacity-35" onClick={() => void clearKind('file')}><span>清除本窗口文件</span><span className="text-xs text-[var(--color-text-tertiary)]">{activeFileCount} 个 ›</span></button>
                </div>
              </>
            ) : (
              <div className="min-h-72">
                <div className="mb-4 flex items-center">
                  <button type="button" className="w-10 text-left text-2xl text-[var(--color-text-secondary)]" onClick={() => setMenuView('main')}>‹</button>
                  <div className="flex-1 text-center text-base font-semibold text-[var(--color-text-heading)]">提示词模块</div>
                  <div className="w-10" />
                </div>
                <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">未分组</div>
                {promptModules.length === 0 ? (
                  <div className="rounded-2xl bg-[var(--color-surface-secondary)] px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">请先到协作者设置中新增模块</div>
                ) : (
                  <div className="max-h-[45vh] overflow-y-auto">
                    {promptModules.map(module => {
                      const enabled = promptModuleOverrides[module.id] ?? module.enabledByDefault
                      return (
                        <button
                          key={module.id}
                          type="button"
                          disabled={promptModulesSaving}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-3.5 text-left text-sm text-[var(--color-text-primary)] disabled:opacity-50"
                          onClick={() => void onPromptModuleToggle?.(module.id, module.enabledByDefault, !enabled)}
                        >
                          <span className="text-[var(--color-primary)]"><LayersIcon /></span>
                          <span className="min-w-0 flex-1 truncate">{module.name}</span>
                          <span className={`text-xl ${enabled ? 'text-[var(--color-primary)]' : 'text-transparent'}`}>✓</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <button type="button" aria-label="添加" aria-expanded={menuOpen} disabled={disabled || sending || uploading} onClick={() => { setMenuView('main'); setMenuOpen(true) }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] disabled:opacity-40">+</button>
        <textarea ref={ref} rows={1} value={value} onChange={event => onChange(event.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} disabled={disabled} placeholder={placeholder || '说点什么'} className="flex-1 border-0 bg-transparent px-1 py-1 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] disabled:opacity-60" />
        <button type="button" onClick={sending ? onStop : submit} disabled={disabled || uploading || (!sending && !hasContent)} aria-label={sending ? '停止生成' : uploading ? '附件上传中' : '发送'} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-colors ${sending ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]' : hasContent && !uploading ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]' : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-disabled)]'}`}>{sending ? '■' : '↑'}</button>
      </div>
    </div>
  )
}
