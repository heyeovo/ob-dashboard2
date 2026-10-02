'use client'
import BodyPortal from '@/app/components/BodyPortal'
import { useEffect, useRef, useState } from 'react'
import CcMarkdown, { highlightSearchText } from './CcMarkdown'
import CcToolDialog from './CcToolDialog'
import { FALLBACK_PERSONA, type CcPersona } from './persona'
import type { CcCompactionEvent, CcMessage, CcProcessEvent, CcToolEvent, CcTurnUsage } from './types'
import CcArtifactCard from './CcArtifactCard'
import { artifactFromToolCall } from '@/app/lib/artifactMeta'
import { modelLabel } from './upstream'
import { parseForwardedMessage } from './forwardedMessage'
import { buildDisplaySegments, buildStableDisplaySegments, type DisplaySegment } from '@/app/lib/cc/displaySegments'
import { useChatDisplayPreferences } from '@/app/lib/chatDisplayPreferences'

// 一条消息。
//
// 用户侧：实心气泡贴右，纯文本（用户说的话不当 markdown 解析）。长按 360ms / 右键出菜单。
// 助手侧：召回按钮行（有召回时）→ thinking / 工具过程 → 正文。
//
// thinking 的行为（跟 Polaris 不同，用户明确要的）：
//   流式中自动展开跟着输出，答完**保持展开**，只能手动收起。
//   Polaris 那边答完自动收起，这里不要。

const LONG_PRESS_MS = 360
const SEGMENT_REVEAL_MS = 360

function ActionIcon({ kind }: { kind: 'copy' | 'copied' | 'select' }) {
  return <svg viewBox="0 0 24 24" className="size-[13px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'copy' ? <><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>
      : kind === 'select' ? <><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/></>
      : <path d="m5 12 4 4L19 6"/>}
  </svg>
}

function ThinkingLabel({ startedAt, active, durationMs }: { startedAt?: number; active: boolean; durationMs?: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  if (active) return <span className="cc-thinking-active">Thinking · {Math.max(0, Math.floor((now - (startedAt || now)) / 1000))}s</span>
  return <span>Thought process{durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''}</span>
}

/** token 明细里的数字：等宽对齐，不加粗到抢眼 */
const USAGE_NUM = 'font-medium tabular-nums text-[var(--color-text-secondary)]'

function UsageTokenButton({ usage, onClick }: { usage: CcTurnUsage; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ml-auto tabular-nums hover:text-[var(--color-text-secondary)]"
      onClick={onClick}
      title="本轮累计消耗；不是当前窗口 Context"
    >
      {(usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens).toLocaleString()} tok
    </button>
  )
}

function UsageDetails({ usage }: { usage: CcTurnUsage }) {
  return (
    <div className="mt-1 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] px-3 py-2 text-left">
      <div className="mb-1.5 text-meta font-medium text-[var(--color-text-secondary)]">本轮累计消耗</div>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2.5 gap-y-1 text-meta text-[var(--color-text-tertiary)]">
        <span>↑ 输入</span>
        <b className={USAGE_NUM}>{usage.inputTokens.toLocaleString()}</b>
        <span>↓ 输出</span>
        <b className={USAGE_NUM}>{usage.outputTokens.toLocaleString()}</b>
        <span>缓存读</span>
        <b className={USAGE_NUM}>{usage.cacheReadTokens.toLocaleString()}</b>
        <span>缓存写</span>
        <b className={USAGE_NUM}>
          {usage.cacheWriteTokens.toLocaleString()}
          {usage.cacheWrite1hTokens || usage.cacheWrite5mTokens ? (
            <span className="font-normal text-[var(--color-text-disabled)]">
              {' '}(1h {usage.cacheWrite1hTokens.toLocaleString()} · 5m {usage.cacheWrite5mTokens.toLocaleString()})
            </span>
          ) : null}
        </b>
        {usage.durationMs ? <><span>时长</span><b className={USAGE_NUM}>{(usage.durationMs / 1000).toFixed(1)}s</b></> : null}
        {usage.tokensPerSec ? <><span>速度</span><b className={USAGE_NUM}>{usage.tokensPerSec.toFixed(1)} tok/s</b></> : null}
      </div>
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function compactTokenLabel(tokens: number | null) {
  if (tokens == null) return '未知'
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens.toLocaleString()
}

function CompactionDivider({ compaction }: { compaction: CcCompactionEvent }) {
  const trigger = compaction.trigger === 'manual' ? '手动压缩已完成' : '自动压缩已完成'
  return (
    <div className="my-4 flex w-full items-center gap-3 text-meta text-[var(--color-pending)]/80" role="separator">
      <span className="h-px flex-1 bg-[var(--color-warning-strong)]/60" />
      <span className="shrink-0 tabular-nums">
        {trigger} · {compactTokenLabel(compaction.preTokens)} → {compactTokenLabel(compaction.postTokens)}
      </span>
      <span className="h-px flex-1 bg-[var(--color-warning-strong)]/60" />
    </div>
  )
}

function shortToolName(name: string) {
  if (name === 'WebSearch') return '网页搜索'
  if (name === 'WebFetch') return '读取网页'
  const parts = name.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : name
}

function toolStatusLabel(tool: CcToolEvent, streaming: boolean) {
  const status = tool.status || (streaming ? 'running' : 'completed')
  if (status === 'running') return '调用中'
  if (status === 'error') return '失败'
  if (status === 'denied') return '已拒绝'
  return tool.durationMs != null ? `${(tool.durationMs / 1000).toFixed(1)}s` : '已完成'
}

type Props = {
  message: CcMessage
  /** 当前消息是否为消息流中最新的助手轮。新一轮出现时，上一轮 thinking 自动折叠。 */
  isCurrentTurn: boolean
  /** 当前选中的协作者，只用来画名字行的头像和名字 */
  persona?: CcPersona
  onCopy: (text: string) => void
  onEditAndResend?: (text: string) => void
  onOpenRecall?: (message: CcMessage) => void
  onRetryPersistence?: (message: CcMessage) => void
  onClearAttachment?: (messageId: string, attachmentId: string) => void
  searchQuery?: string
  searchActive?: boolean
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: (messageId: string) => void
  onStartSelect?: (messageId: string) => void
}

export function ccMessageVisibleText(message: CcMessage): string {
  if (message.role === 'system') return ''
  if (message.role === 'user') return parseForwardedMessage(message.text)?.userText ?? message.text
  const process = message.process || []
  if (!process.some(event => event.type === 'text')) return message.text
  const last = process.at(-1)
  return last?.type === 'text' ? last.text : ''
}

function AssistantSegments({
  segments,
  messageId,
  keyPrefix,
  animate = false,
  searchQuery = '',
  searchActive = false,
}: {
  segments: DisplaySegment[]
  messageId: string
  keyPrefix: string
  animate?: boolean
  searchQuery?: string
  searchActive?: boolean
}) {
  return (
    <div className="cc-assistant-segments">
      {segments.map((segment, index) => {
        return (
          <div
            className={`cc-bubble-assistant${segment.kind === 'text' ? ' cc-bubble-assistant-segment' : ''}${animate ? ' entering' : ''}`}
            key={`${messageId}-${keyPrefix}-${index}`}
          >
            <CcMarkdown text={segment.markdown} searchQuery={searchQuery} searchActive={searchActive} />
          </div>
        )
      })}
    </div>
  )
}

function shortClock(value: string | number) {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function CcMessageRow({
  message,
  isCurrentTurn,
  persona: personaProp,
  onCopy,
  onEditAndResend,
  onOpenRecall,
  onRetryPersistence,
  onClearAttachment,
  searchQuery = '',
  searchActive = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onStartSelect,
}: Props) {
  const isUser = message.role === 'user'
  const persona = personaProp || FALLBACK_PERSONA
  const shownModel = modelLabel(message.model || '')
  const usage = message.usage || null
  const { showRuntimeInfo, showTokenInfo } = useChatDisplayPreferences()
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copyTimer.current != null) window.clearTimeout(copyTimer.current) }, [])
  const copyMessage = (text: string) => {
    onCopy(text)
    setCopied(true)
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1200)
  }
  // 新生成的当前轮默认展开；从 Haven 读回的历史轮默认折叠。
  // 状态只属于当前页面：实时轮结束后保持展开，刷新后会按历史规则重新折叠。
  const [thinkingOpen, setThinkingOpen] = useState(isCurrentTurn && !message.fromHistory)
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  const [openToolsGroupId, setOpenToolsGroupId] = useState<string | null>(null)
  // 这一轮的 token 明细，默认收着
  const [usageOpen, setUsageOpen] = useState(false)
  // 上下文预算是诊断信息，收进图标浮窗，避免元数据行过长。
  const [contextOpen, setContextOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
  const messageProcess = message.process || []
  const messageLastProcessEvent = messageProcess.at(-1)
  const isActivelyThinking = Boolean(
    message.streaming &&
    messageLastProcessEvent?.type === 'thinking' &&
    messageLastProcessEvent.durationMs == null,
  )
  const messageTrailingText = messageLastProcessEvent?.type === 'text'
    ? messageLastProcessEvent.text
    : ''
  const renderedSegments = messageProcess.some(event => event.type === 'text')
    ? buildStableDisplaySegments(messageTrailingText, !message.streaming).segments
    : message.displaySegments || []
  const segmentCount = renderedSegments.length
  const shouldRevealSegments = Boolean(message.revealDisplaySegments && isCurrentTurn)
  const [visibleSegmentCount, setVisibleSegmentCount] = useState(() => (
    shouldRevealSegments && segmentCount > 0 ? 1 : segmentCount
  ))
  const timerRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (e: PointerEvent) => {
      if (e.target instanceof Node && frameRef.current?.contains(e.target)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [menuOpen])

  useEffect(() => {
    if (!contextOpen) return
    const onOutside = (e: PointerEvent) => {
      if (e.target instanceof Node && contextRef.current?.contains(e.target)) return
      setContextOpen(false)
    }
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextOpen(false)
    }
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [contextOpen])

  useEffect(() => {
    if (!forwardOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setForwardOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onEscape)
    }
  }, [forwardOpen])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (segmentCount === 0) {
      setVisibleSegmentCount(0)
      return
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (!shouldRevealSegments || reduceMotion || segmentCount === 1) {
      setVisibleSegmentCount(segmentCount)
      return
    }
    setVisibleSegmentCount(current => Math.max(1, Math.min(current, segmentCount)))
  }, [shouldRevealSegments, segmentCount])

  useEffect(() => {
    if (!shouldRevealSegments || visibleSegmentCount >= segmentCount) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (reduceMotion) {
      setVisibleSegmentCount(segmentCount)
      return
    }
    const revealDelay = isCurrentTurn && !message.fromHistory ? 180 : SEGMENT_REVEAL_MS
    const timer = window.setTimeout(() => {
      setVisibleSegmentCount(current => Math.min(segmentCount, current + 1))
    }, revealDelay)
    return () => window.clearTimeout(timer)
  }, [isCurrentTurn, message.fromHistory, shouldRevealSegments, segmentCount, visibleSegmentCount])

  if (message.role === 'system' && message.compaction) {
    return <CompactionDivider compaction={message.compaction} />
  }
  if (message.role === 'system' && message.wakeEvent) {
    return (
      <div className="my-3 w-full" data-role="agent-wake-event">
        <div className="flex items-center gap-3 text-2xs text-[var(--color-text-tertiary)]" role="separator">
          <span className="h-px flex-1 bg-[var(--color-border-light)]" />
          <span className="shrink-0">{shortClock(message.wakeEvent.at || message.createdAt)} · {persona.name || '言之'}醒了一次</span>
          <span className="h-px flex-1 bg-[var(--color-border-light)]" />
        </div>
        <div className="mx-auto mt-1 max-w-md space-y-0.5 px-3 text-center text-2xs text-[var(--color-text-tertiary)]">
          {message.wakeEvent.status ? (
            <div className="text-[var(--color-text-secondary)]">这次没有发消息 · {message.wakeEvent.status}</div>
          ) : null}
          {message.nextWake ? (
            <div>
              ↳ 下次唤醒 {shortClock(message.nextWake.at)}{message.nextWake.reason ? ` · ${message.nextWake.reason}` : ''}
            </div>
          ) : null}
        </div>
        {message.thinking ? (
          <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] text-meta">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              aria-expanded={thinkingOpen}
              onClick={() => setThinkingOpen(open => !open)}
            >
              <span className={`cc-fold-caret${thinkingOpen ? ' open' : ''}`} aria-hidden="true" />
              <span>Thought process{message.thinkingMs ? ` · ${(message.thinkingMs / 1000).toFixed(1)}s` : ''}</span>
            </button>
            {thinkingOpen ? (
              <div className="border-t border-[var(--color-border-light)] px-3 py-2 text-[var(--color-text-secondary)]">
                <CcMarkdown text={message.thinking} />
              </div>
            ) : null}
          </div>
        ) : null}
        {usage ? (
          <div className="mt-1 flex items-center text-meta text-[var(--color-text-tertiary)]">
            <UsageTokenButton usage={usage} onClick={() => setUsageOpen(open => !open)} />
          </div>
        ) : null}
        {usage && usageOpen ? <UsageDetails usage={usage} /> : null}
      </div>
    )
  }

  const clearTimer = () => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const openMenu = () => {
    if (!isUser || message.fromHistory) return
    setMenuOpen(true)
  }

  const canSelect = Boolean(ccMessageVisibleText(message).trim()) && !message.streaming
  const forwardedMessage = isUser ? parseForwardedMessage(message.text) : null
  const rawUserText = forwardedMessage?.userText ?? message.text
  const userText = isUser ? rawUserText.replace(/\n\n<xhs_note[\s\S]*<\/xhs_note>$/m, '').trim() : rawUserText

  const beginLongPress = (pointerType: string) => {
    if (pointerType === 'mouse' || !canSelect) return
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      // 长按只开「你的消息」的编辑菜单（2a 之前的行为）；多选改由操作行的多选图标进入，
      // 否则会跟系统长按选字抢手势。
      openMenu()
    }, LONG_PRESS_MS)
  }

  const handleSelectClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (selectMode && canSelect) onToggleSelect?.(message.id)
  }

  const selectionCheckbox = selectMode && canSelect ? (
    <input
      type="checkbox"
      checked={selected}
      readOnly
      tabIndex={-1}
      aria-label={selected ? '取消选择这条消息' : '选择这条消息'}
      className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]"
    />
  ) : null

  /* ---------- 用户侧 ---------- */
  if (isUser) {
    return (
      <>
      <div
        className={`cc-row min-w-0 max-w-full flex items-start gap-2 ${selectMode && canSelect ? 'cursor-pointer' : ''}`}
        data-role="user"
        data-message-id={message.id}
        onClick={handleSelectClick}
        onPointerDown={event => beginLongPress(event.pointerType)}
        onPointerUp={clearTimer}
        onPointerCancel={clearTimer}
        onPointerMove={clearTimer}
        onPointerLeave={clearTimer}
      >
        {selectionCheckbox}
        <div ref={frameRef} className="min-w-0 flex-1 flex flex-col items-end">
          <div
            className="flex min-w-0 max-w-full flex-col items-end gap-2"
            onContextMenu={e => {
              if (message.fromHistory) return
              e.preventDefault()
              openMenu()
            }}
            onPointerDown={e => {
              if (onStartSelect) return
              beginLongPress(e.pointerType)
            }}
            onPointerUp={clearTimer}
            onPointerCancel={clearTimer}
            onPointerMove={clearTimer}
            onPointerLeave={clearTimer}
          >
            {message.attachments?.length ? (
              <div className={`grid max-w-[var(--chat-attachment-width)] gap-2 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {message.attachments.map(attachment => (
                  <div key={attachment.id} className="group/image relative overflow-hidden rounded-xl bg-[var(--color-surface-secondary)]">
                    {attachment.cleared || !attachment.previewUrl ? (
                      <div className="flex h-24 min-w-40 items-center justify-center px-3 text-xs text-[var(--color-text-tertiary)]">
                        {attachment.kind === 'image' ? '图片已清除' : '文件已清除'}
                      </div>
                    ) : attachment.kind === 'image' ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- Haven 私有路由，不走公开图片优化器 */}
                        <img
                          src={attachment.previewUrl}
                          alt={attachment.filename}
                          loading="lazy"
                          className="max-h-64 w-full object-contain"
                        />
                        {onClearAttachment ? (
                          <button
                            type="button"
                            aria-label={`清除图片 ${attachment.filename}`}
                            title="从 Haven 永久清除图片"
                            className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-[var(--color-overlay)]/55 text-sm text-[var(--color-on-primary)] opacity-100 transition-opacity hover:bg-[var(--color-overlay)]/70 sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100"
                            onClick={event => {
                              event.stopPropagation()
                              onClearAttachment(message.id, attachment.id)
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <a
                          href={attachment.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-h-24 min-w-56 items-center gap-3 px-4 py-3 text-left"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-primary)]" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M9 13h6M9 16h4"/></svg>
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{attachment.filename}</span>
                            <span className="mt-0.5 block text-2xs text-[var(--color-text-tertiary)]">
                              {formatBytes(attachment.byteSize)}{attachment.textTruncated ? ' · 内容已截断' : ' · 已读取'}
                            </span>
                          </span>
                        </a>
                        {onClearAttachment ? (
                          <button
                            type="button"
                            aria-label={`清除文件 ${attachment.filename}`}
                            title="从 Haven 永久清除文件"
                            className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-[var(--color-overlay)]/55 text-sm text-[var(--color-on-primary)] opacity-100 transition-opacity hover:bg-[var(--color-overlay)]/70 sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100"
                            onClick={event => {
                              event.stopPropagation()
                              onClearAttachment(message.id, attachment.id)
                            }}
                          >×</button>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
            {forwardedMessage ? (
              <button
                type="button"
                className="w-full max-w-[var(--chat-attachment-width)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-left"
                aria-label={`查看转发消息：${forwardedMessage.title}`}
                onClick={event => {
                  event.stopPropagation()
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  if (selectMode && canSelect) {
                    onToggleSelect?.(message.id)
                    return
                  }
                  setForwardOpen(true)
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-meta font-medium text-[var(--color-text-secondary)]">
                    转发 · {forwardedMessage.title} · {forwardedMessage.lines.length} 条
                  </span>
                  <span className="shrink-0 text-sm text-[var(--color-text-tertiary)]" aria-hidden="true">›</span>
                </div>
                <div className="mt-1 text-meta leading-relaxed text-[var(--color-text-tertiary)]">
                  {forwardedMessage.lines.slice(0, 3).map((line, index) => (
                    <div key={index} className="truncate">{line}</div>
                  ))}
                  {forwardedMessage.lines.length > 3 ? (
                    <div>…还有 {forwardedMessage.lines.length - 3} 条</div>
                  ) : null}
                </div>
              </button>
            ) : null}
            {userText ? (
              <div className="cc-bubble-user">
                {highlightSearchText(userText, searchQuery, searchActive)}
              </div>
            ) : null}
          </div>

          {menuOpen ? (
            <div className="cc-popmenu mt-2 flex gap-1">
              <button
                type="button"
                className="cc-popmenu-item"
                  onClick={() => {
                  onCopy(userText)
                  setMenuOpen(false)
                }}
              >
                复制
              </button>
              {onEditAndResend ? (
                <button
                  type="button"
                  className="cc-popmenu-item"
                  onClick={() => {
                    onEditAndResend(userText)
                    setMenuOpen(false)
                  }}
                >
                  编辑并重发
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="cc-row-actions cc-time mt-1 flex flex-row-reverse items-center gap-3 pr-1">
            <button type="button" aria-label="复制消息" title="复制" onClick={event => { event.stopPropagation(); copyMessage(userText) }}><ActionIcon kind={copied ? 'copied' : 'copy'} /></button>
            {canSelect ? <button type="button" aria-label="多选消息" title="多选" onClick={event => { event.stopPropagation(); onStartSelect?.(message.id) }}><ActionIcon kind="select" /></button> : null}
            <span>{shortClock(message.createdAt)}</span>
          </div>
        </div>
      </div>
      {forwardedMessage && forwardOpen ? (
        <BodyPortal><div className="cc-modal-scrim fixed inset-0 z-50 flex items-end justify-center sm:p-4">
          <button type="button" aria-label="关闭转发消息" onClick={() => setForwardOpen(false)} className="absolute inset-0" />
          <div role="dialog" aria-modal="true" aria-label={`转发消息：${forwardedMessage.title}`} className="cc-modal cc-tool-sheet relative flex max-h-[var(--chat-sheet-height)] w-full max-w-2xl flex-col">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--color-overlay)]/10 sm:hidden" />
            <div className="flex items-start gap-3 border-b border-[var(--color-border-light)] px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-md font-semibold text-[var(--color-text-heading)]">
                  转发 · {forwardedMessage.title}
                </h2>
                <p className="mt-1 text-2xs text-[var(--color-text-disabled)]">共 {forwardedMessage.lines.length} 条消息</p>
              </div>
              <button type="button" onClick={() => setForwardOpen(false)} className="text-meta text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                关闭
              </button>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-3">
                {forwardedMessage.lines.map((line, index) => (
                  <div key={index} className="whitespace-pre-wrap break-words rounded-xl bg-[var(--color-surface-secondary)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div></BodyPortal>
      ) : null}
      </>
    )
  }

  /* ---------- 助手侧 ---------- */
  // 历史消息不记「当时是谁回的」，一律按当前协作者显示。要按轮存 persona 是以后的事。
  const savedProcess = message.process || []
  const tools =
    message.tools?.length
      ? message.tools
      : savedProcess.flatMap(event => event.type === 'tool' ? [event.tool] : [])
  const process: CcProcessEvent[] =
    savedProcess.length > 0
      ? savedProcess
      : [
          ...(message.thinking
            ? [{
                type: 'thinking' as const,
                id: `legacy-thinking-${message.id}`,
                text: message.thinking,
                durationMs: message.thinkingMs,
              }]
            : []),
          ...tools.map(tool => ({
            type: 'tool' as const,
            id: `legacy-tool-${tool.id}`,
            tool,
          })),
        ]
  // 最后一段可见文字就是正式回答；此前的文字留在过程时间线原位。
  // 老记录没有 text 事件，继续使用 message.text，避免改变既有历史。
  const lastProcessEvent = process.at(-1)
  const trailingText = lastProcessEvent?.type === 'text' ? lastProcessEvent : null
  const visibleProcess = trailingText ? process.slice(0, -1) : process
  type ProcessGroup = Exclude<CcProcessEvent, { type: 'tool' }> | { type: 'tools'; id: string; tools: CcToolEvent[] }
  const processGroups: ProcessGroup[] = []
  for (const event of visibleProcess) {
    if (event.type !== 'tool') { processGroups.push(event); continue }
    const previous = processGroups.at(-1)
    if (previous?.type === 'tools') previous.tools.push(event.tool)
    else processGroups.push({ type: 'tools', id: event.id, tools: [event.tool] })
  }
  const hasProcessText = process.some(event => event.type === 'text')
  const finalText = hasProcessText
    ? trailingText?.text || ''
    : message.text
  // displaySegments 保存的是整轮正文；过程时间线存在 text 事件时，前面的正文已经
  // 在其真实位置展示，这里只能为最后一段重新拆泡，不能再次渲染整轮正文。
  const finalSegments = hasProcessText
    ? renderedSegments
    : message.displaySegments || []
  const openTool = openToolId ? tools.find(tool => tool.id === openToolId) || null : null
  // 同一轮里同一个作品写了又改，只在最后一次成功调用下面出卡。
  const artifactCardByToolId = new Map<string, NonNullable<ReturnType<typeof artifactFromToolCall>>>()
  {
    const latest = new Map<string, string>()
    for (const tool of tools) {
      if (tool.status === 'error' || tool.status === 'denied' || tool.status === 'running') continue
      const artifact = artifactFromToolCall(tool.name, tool.input)
      if (!artifact) continue
      const previous = latest.get(artifact.name)
      const previousTitle = previous ? artifactCardByToolId.get(previous)?.title : ''
      if (previous) artifactCardByToolId.delete(previous)
      latest.set(artifact.name, tool.id)
      artifactCardByToolId.set(tool.id, { ...artifact, title: artifact.title || previousTitle || '' })
    }
  }
  return (
    <div
      className={`cc-row min-w-0 max-w-full flex items-start gap-2 ${selectMode && canSelect ? 'cursor-pointer' : ''}`}
      data-role="assistant"
      data-message-id={message.id}
      onClick={handleSelectClick}
      onPointerDown={event => beginLongPress(event.pointerType)}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerMove={clearTimer}
      onPointerLeave={clearTimer}
    >
      {selectionCheckbox}
      <div className="cc-assistant-block min-w-0 flex-1">
        {/* 只有两个人聊，不再每条标头像和名字；这一行只剩召回按钮，没召回就不占位。以后群聊再按条件加回来 */}
        {message.recall ? (
          <div className="cc-namerow">
            <button
              type="button"
              className="cc-recall-btn"
              onClick={() => onOpenRecall?.(message)}
              title="点开看这一轮各模块注入了什么"
            >
              {message.recall.injected
                ? `记忆 ${message.recall.card_count} · 约 ${message.recall.estimated_tokens ?? 0} token`
                : '未召回'}
            </button>
          </div>
        ) : null}

        {/* Thinking、助手中间回复与工具按真实顺序展示；末尾文字作为正式回答。 */}
        {processGroups.length > 0 ? (
          <div className="cc-process">
            {processGroups.map((event, index) => {
              if (event.type === 'thinking') {
                const isActive =
                  Boolean(message.streaming) &&
                  index === processGroups.length - 1 &&
                  event.durationMs == null
                return (
                  <div className="cc-think" key={event.id}>
                    <button
                      type="button"
                      className="cc-think-toggle"
                      onClick={() => setThinkingOpen(value => !value)}
                    >
                      <span>
                        <ThinkingLabel startedAt={event.startedAt} active={isActive} durationMs={event.durationMs} />
                      </span>
                      <span
                        className={`cc-fold-caret${thinkingOpen ? ' open' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                    {thinkingOpen
                      ? <div className="cc-think-body">{event.text}</div>
                      : null}
                  </div>
                )
              }

              if (event.type === 'text') {
                return (
                  <AssistantSegments
                    key={event.id}
                    segments={buildDisplaySegments(event.text).segments}
                    messageId={message.renderKey || message.id}
                    keyPrefix={event.id}
                  />
                )
              }

              if (event.type === 'room') {
                const duration = (event.durationMs || 0) < 60_000 ? '不到 1 分钟' : Math.floor((event.durationMs || 0) / 60_000) + ' 分钟'
                const lock = event.lockUntil ? new Date(event.lockUntil).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(5, 16) : ''
                return <div key={event.id} className="cc-think-toggle">
                  {event.leftAt == null ? '言之在房间里…' : '言之进了房间 · 待了 ' + duration}
                  {lock ? ' · 锁到 ' + lock : ''}
                </div>
              }
              if (event.type === 'compact') {
                return <CompactionDivider key={event.id} compaction={event.compaction} />
              }

              const isOpen = openToolsGroupId === event.id
              return (
                <div className="cc-toolstrip" key={event.id}>
                  <button
                    type="button"
                    className="cc-think-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setOpenToolsGroupId(current => current === event.id ? null : event.id)}
                  >
                    <span>Tools · {event.tools.length}</span>
                    <span className={`cc-fold-caret${isOpen ? ' open' : ''}`} aria-hidden="true" />
                  </button>
                  {isOpen ? event.tools.map(tool => <div key={tool.id}>
                    <button type="button" className="cc-toolchip pl-4" onClick={() => setOpenToolId(tool.id)}>
                      <span className="cc-toolchip-name">{shortToolName(tool.name)}</span>
                      <span className={`cc-tool-status ${tool.status || (message.streaming ? 'running' : 'completed')}`}>{toolStatusLabel(tool, Boolean(message.streaming))}</span>
                      <span className="cc-fold-caret" aria-hidden="true" />
                    </button>
                  </div>) : null}
                  {/* 小作品卡片不跟着 Tools 折叠，照旧直接显示 */}
                  {event.tools.map(tool => artifactCardByToolId.has(tool.id)
                    ? <CcArtifactCard key={`artifact-${tool.id}`} {...artifactCardByToolId.get(tool.id)!} />
                    : null)}
                </div>
              )
            })}
          </div>
        ) : null}

        {/* 正文：只有完整段落才整颗显现；流式中的半截留在缓冲区。 */}
        {finalSegments.length ? (
          <AssistantSegments
            segments={finalSegments.slice(0, visibleSegmentCount)}
            messageId={message.renderKey || message.id}
            keyPrefix="final"
            animate={shouldRevealSegments}
            searchQuery={searchQuery}
            searchActive={searchActive}
          />
        ) : !message.streaming && finalText ? (
          <div className="cc-bubble-assistant">
            <CcMarkdown text={finalText} searchQuery={searchQuery} searchActive={searchActive} />
          </div>
        ) : null}

        {message.streaming && !isActivelyThinking ? (
          <div className="cc-assistant-pending" aria-label="正在组织下一条消息">
            <span className="cc-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}

        {message.nextWake ? (
          <div className="mt-1 text-2xs text-[var(--color-text-tertiary)]">
            ↳ 下次唤醒 {shortClock(message.nextWake.at)}{message.nextWake.reason ? ` · ${message.nextWake.reason}` : ''}
          </div>
        ) : null}

        {/* 被停止的半截回复：在正文下方标一句，不跟完整回复混着看 */}
        {message.interrupted && !message.streaming ? (
          <div className="mt-1 text-meta text-[var(--color-text-tertiary)]">
            {message.interruptedReason === 'pro_limit' ? 'Pro 额度中断' : '已停止生成'}
          </div>
        ) : null}

        {/* 开发者模式：引擎/模型/Provider */}
        {!message.streaming && showRuntimeInfo && (message.engine || message.providerLabel || shownModel) ? (
          <div className="relative mt-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)]/70 px-3 py-2 text-2xs text-[var(--color-text-tertiary)]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {message.engine ? <span>引擎：{message.engine === 'selfhost' ? '自建' : 'cc'}</span> : null}
              {message.providerLabel ? <span>Provider：{message.providerLabel}</span> : null}
              {shownModel ? <span>模型：{shownModel}</span> : null}
            </div>
          </div>
        ) : null}

        {/* 行内操作和时间 */}
        {!message.streaming && message.text ? (
          <div className="cc-row-actions flex items-center gap-3 pt-0.5 text-meta text-[var(--color-text-tertiary)]">
            <button
              type="button"
              aria-label="复制消息" title="复制"
              className="hover:text-[var(--color-text-secondary)]"
              onClick={event => { event.stopPropagation(); copyMessage(message.text) }}><ActionIcon kind={copied ? 'copied' : 'copy'} /></button>
            {canSelect ? <button type="button" aria-label="多选消息" title="多选" onClick={event => { event.stopPropagation(); onStartSelect?.(message.id) }}><ActionIcon kind="select" /></button> : null}
            <span className="cc-time">{shortClock(message.createdAt)}</span>

            {/* 保存状态图标 */}
            {message.deliveryState === 'saving' ? (
              <span title={message.deliveryNote || '保存中…'} className="cc-saving-indicator size-2 rounded-full border border-current" />
            ) : message.deliveryState === 'detached' ? (
              // 断线只是浏览器没在看，轮次仍在服务端跑：用保存中的小圆点 + 次要文字，不用报错红。
              <>
                <span title={message.deliveryNote} className="cc-saving-indicator size-2 rounded-full border border-current" />
                {message.deliveryNote ? (
                  <span className="text-xs text-[var(--color-text-tertiary)]">{message.deliveryNote}</span>
                ) : null}
              </>
            ) : message.deliveryState && !['saved', 'replayed', 'generating', 'stopped'].includes(message.deliveryState) ? (
              <>
                <button
                  type="button"
                  title={message.deliveryNote || '保存异常'}
                  onClick={() => {
                    if (message.deliveryState === 'persistence_unknown' && onRetryPersistence) {
                      onRetryPersistence(message)
                    }
                  }}
                  className={`text-[var(--color-danger-strong)] ${message.deliveryState === 'persistence_unknown' && onRetryPersistence ? 'cursor-pointer hover:text-[var(--color-danger)]' : 'cursor-default'}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="7" />
                    <path d="M8 4.5v4" />
                    <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
                  </svg>
                </button>
                {message.deliveryNote ? (
                  <span className="text-xs text-[var(--color-danger-strong)]/80">{message.deliveryNote}</span>
                ) : null}
              </>
            ) : null}

            {/* 上下文详情 */}
            {message.context ? (
              <div ref={contextRef} className="relative">
                <button
                  type="button"
                  aria-label="上下文详情"
                  aria-expanded={contextOpen}
                  title="上下文详情"
                  onClick={() => setContextOpen(open => !open)}
                  className="flex items-center justify-center text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.9 19a9 9 0 1 1 14.2 0" />
                    <path d="m12 14 3.5-3.5" />
                    <path d="M12 5v1.5M5 12h1.5M17.5 12H19" />
                  </svg>
                </button>
                {contextOpen ? (
                  <div
                    role="dialog"
                    aria-label="上下文详情"
                    className="absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] p-3 text-meta text-[var(--color-text-tertiary)] shadow-lg"
                  >
                    <div className="mb-2 font-medium text-[var(--color-text-secondary)]">上下文详情</div>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
                      <dt>本轮总输入估算</dt>
                      <dd className={USAGE_NUM}>{message.context.inputTokensEstimated.toLocaleString()}</dd>
                      <dt>带入历史</dt>
                      <dd className={USAGE_NUM}>{message.context.includedHistoryRounds.toLocaleString()} 轮</dd>
                      <dt>丢弃历史</dt>
                      <dd className={USAGE_NUM}>{message.context.omittedHistoryRounds.toLocaleString()} 轮</dd>
                      <dt>历史估算</dt>
                      <dd className={USAGE_NUM}>{message.context.historyTokensEstimated.toLocaleString()} token</dd>
                      <dt>模型名义上限</dt>
                      <dd className={USAGE_NUM}>{message.context.modelContextLimit.toLocaleString()}</dd>
                      <dt>回复预留</dt>
                      <dd className={USAGE_NUM}>{message.context.replyReserveTokens.toLocaleString()} token</dd>
                    </dl>
                  </div>
                ) : null}
              </div>
            ) : null}

            {usage && showTokenInfo ? (
              <UsageTokenButton usage={usage} onClick={() => setUsageOpen(v => !v)} />
            ) : null}
          </div>
        ) : null}

        {/* token 明细。⚠️ 「缓存读」那部分是按 1/10 价计费的，别把它跟输入加起来看成花了多少钱 */}
        {usage && showTokenInfo && usageOpen ? <UsageDetails usage={usage} /> : null}
      </div>

      {openTool ? <CcToolDialog tool={openTool} onClose={() => setOpenToolId(null)} /> : null}
    </div>
  )
}
