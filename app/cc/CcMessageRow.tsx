'use client'
import { useEffect, useRef, useState } from 'react'
import CcMarkdown, { highlightSearchText } from './CcMarkdown'
import CcToolDialog from './CcToolDialog'
import { FALLBACK_PERSONA, type CcPersona } from './persona'
import type { CcCompactionEvent, CcMessage, CcProcessEvent, CcToolEvent, CcTurnUsage } from './types'
import { modelLabel } from './upstream'
import { parseForwardedMessage } from './forwardedMessage'

// 一条消息。
//
// 用户侧：实心气泡贴右，纯文本（用户说的话不当 markdown 解析）。长按 360ms / 右键出菜单。
// 助手侧：名字行（头像 + persona 名 + 时间 + 最右召回按钮）→ thinking / 工具过程 → 正文。
//
// thinking 的行为（跟 Polaris 不同，用户明确要的）：
//   流式中自动展开跟着输出，答完**保持展开**，只能手动收起。
//   Polaris 那边答完自动收起，这里不要。

const LONG_PRESS_MS = 360
const SEGMENT_REVEAL_MS = 360

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
      <div className="mb-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">本轮累计消耗</div>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
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

function formatTime(ms: number) {
  const d = new Date(ms)
  const yyyy = String(d.getFullYear()).padStart(4, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}-${month}-${day} ${hh}:${mm}:${ss}`
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
    <div className="my-4 flex w-full items-center gap-3 text-[11px] text-amber-700/80" role="separator">
      <span className="h-px flex-1 bg-amber-300/60" />
      <span className="shrink-0 tabular-nums">
        {trigger} · {compactTokenLabel(compaction.preTokens)} → {compactTokenLabel(compaction.postTokens)}
      </span>
      <span className="h-px flex-1 bg-amber-300/60" />
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
  const [menuOpen, setMenuOpen] = useState(false)
  // 新生成的当前轮默认展开；从 Haven 读回的历史轮默认折叠。
  // 状态只属于当前页面：实时轮结束后保持展开，刷新后会按历史规则重新折叠。
  const [thinkingOpen, setThinkingOpen] = useState(isCurrentTurn && !message.fromHistory)
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  // 这一轮的 token 明细，默认收着
  const [usageOpen, setUsageOpen] = useState(false)
  // 上下文预算是诊断信息，收进图标浮窗，避免元数据行过长。
  const [contextOpen, setContextOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
  const segmentCount = message.displaySegments?.length || 0
  const [visibleSegmentCount, setVisibleSegmentCount] = useState(() => (
    message.revealDisplaySegments && segmentCount > 0 ? 1 : segmentCount
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
    if (!message.revealDisplaySegments || reduceMotion || segmentCount === 1) {
      setVisibleSegmentCount(segmentCount)
      return
    }
    setVisibleSegmentCount(current => Math.max(1, Math.min(current, segmentCount)))
  }, [message.revealDisplaySegments, segmentCount])

  useEffect(() => {
    if (!message.revealDisplaySegments || visibleSegmentCount >= segmentCount) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (reduceMotion) {
      setVisibleSegmentCount(segmentCount)
      return
    }
    const timer = window.setTimeout(() => {
      setVisibleSegmentCount(current => Math.min(segmentCount, current + 1))
    }, SEGMENT_REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [message.revealDisplaySegments, segmentCount, visibleSegmentCount])

  if (message.role === 'system' && message.compaction) {
    return <CompactionDivider compaction={message.compaction} />
  }
  if (message.role === 'system' && message.wakeEvent) {
    return (
      <div className="my-3 w-full" data-role="agent-wake-event">
        <div className="flex items-center gap-3 text-[10.5px] text-[var(--color-text-tertiary)]" role="separator">
          <span className="h-px flex-1 bg-[var(--color-border-light)]" />
          <span className="shrink-0">{shortClock(message.wakeEvent.at || message.createdAt)} · {persona.name || '言之'}醒了一次</span>
          <span className="h-px flex-1 bg-[var(--color-border-light)]" />
        </div>
        <div className="mx-auto mt-1 max-w-md space-y-0.5 px-3 text-center text-[10.5px] text-[var(--color-text-tertiary)]">
          {message.wakeEvent.reason ? (
            <div>唤醒原因 · {message.wakeEvent.reason}</div>
          ) : null}
          {message.wakeEvent.status ? (
            <div className="text-[var(--color-text-secondary)]">没有发消息 · {message.wakeEvent.status}</div>
          ) : null}
          {message.nextWake ? (
            <div>
              ↳ 下次唤醒 {shortClock(message.nextWake.at)}{message.nextWake.reason ? ` · ${message.nextWake.reason}` : ''}
            </div>
          ) : null}
        </div>
        {message.thinking ? (
          <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] text-[11px]">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              aria-expanded={thinkingOpen}
              onClick={() => setThinkingOpen(open => !open)}
            >
              <span className={`cc-think-caret${thinkingOpen ? ' open' : ''}`} aria-hidden="true" />
              <span>Claude 的深度思考{message.thinkingMs ? ` (${(message.thinkingMs / 1000).toFixed(1)}s)` : ''}</span>
            </button>
            {thinkingOpen ? (
              <div className="border-t border-[var(--color-border-light)] px-3 py-2 text-[var(--color-text-secondary)]">
                <CcMarkdown text={message.thinking} />
              </div>
            ) : null}
          </div>
        ) : null}
        {usage ? (
          <div className="mt-1 flex items-center text-[11px] text-[var(--color-text-tertiary)]">
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
      if (onStartSelect) {
        suppressClickRef.current = true
        setMenuOpen(false)
        onStartSelect(message.id)
        return
      }
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
              <div className={`grid max-w-[360px] gap-2 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
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
                            className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-sm text-white opacity-100 transition-opacity hover:bg-black/70 sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100"
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
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--color-primary)]" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M9 13h6M9 16h4"/></svg>
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{attachment.filename}</span>
                            <span className="mt-0.5 block text-[10px] text-[var(--color-text-tertiary)]">
                              {formatBytes(attachment.byteSize)}{attachment.textTruncated ? ' · 内容已截断' : ' · 已读取'}
                            </span>
                          </span>
                        </a>
                        {onClearAttachment ? (
                          <button
                            type="button"
                            aria-label={`清除文件 ${attachment.filename}`}
                            title="从 Haven 永久清除文件"
                            className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-sm text-white opacity-100 transition-opacity hover:bg-black/70 sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100"
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
                className="w-full max-w-[360px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-left"
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
                  <span className="min-w-0 truncate text-[11px] font-medium text-[var(--color-text-secondary)]">
                    转发 · {forwardedMessage.title} · {forwardedMessage.lines.length} 条
                  </span>
                  <span className="shrink-0 text-sm text-[var(--color-text-tertiary)]" aria-hidden="true">›</span>
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
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

          <div className="cc-row-actions cc-time mt-1 pr-1">{formatTime(message.createdAt)}</div>
        </div>
      </div>
      {forwardedMessage && forwardOpen ? (
        <div className="cc-modal-scrim fixed inset-0 z-50 flex items-end justify-center sm:p-4">
          <button type="button" aria-label="关闭转发消息" onClick={() => setForwardOpen(false)} className="absolute inset-0" />
          <div role="dialog" aria-modal="true" aria-label={`转发消息：${forwardedMessage.title}`} className="cc-modal cc-tool-sheet relative flex max-h-[86vh] w-full max-w-2xl flex-col">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/10 sm:hidden" />
            <div className="flex items-start gap-3 border-b border-[var(--color-border-light)] px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-[var(--color-text-heading)]">
                  转发 · {forwardedMessage.title}
                </h2>
                <p className="mt-1 text-[10px] text-[var(--color-text-disabled)]">共 {forwardedMessage.lines.length} 条消息</p>
              </div>
              <button type="button" onClick={() => setForwardOpen(false)} className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                关闭
              </button>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-3">
                {forwardedMessage.lines.map((line, index) => (
                  <div key={index} className="whitespace-pre-wrap break-words rounded-xl bg-[var(--color-surface-secondary)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
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
  const finalText = process.some(event => event.type === 'text')
    ? trailingText?.text || ''
    : message.text
  const openTool = openToolId ? tools.find(tool => tool.id === openToolId) || null : null
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
        {/* 名字行：头像 + 名字 + 时间，最右是这一轮的召回按钮 */}
        <div className="cc-namerow">
          <span className="cc-avatar" style={{ background: persona.tint }} aria-hidden="true">
            {persona.initial}
          </span>
          <span className="cc-name">{persona.name}</span>
          {message.recall ? (
            <button
              type="button"
              className="cc-recall-btn"
              onClick={() => onOpenRecall?.(message)}
              title="点开看这一轮各模块注入了什么"
            >
              {message.recall.injected
                ? `记忆 ${message.recall.card_count} · ${message.recall.chars} 字`
                : '未召回'}
            </button>
          ) : null}
        </div>

        {/* Thinking、助手中间回复与工具按真实顺序展示；末尾文字作为正式回答。 */}
        {visibleProcess.length > 0 ? (
          <div className="cc-process">
            {visibleProcess.map((event, index) => {
              if (event.type === 'thinking') {
                const thinkingIndex =
                  visibleProcess.slice(0, index).filter(item => item.type === 'thinking').length
                const isActive =
                  Boolean(message.streaming) &&
                  index === visibleProcess.length - 1 &&
                  event.durationMs == null
                const title = thinkingIndex === 0 ? '深度思考' : '继续思考'
                return (
                  <div className="cc-think" key={event.id}>
                    <button
                      type="button"
                      className="cc-think-toggle"
                      onClick={() => setThinkingOpen(value => !value)}
                    >
                      <span className="cc-process-icon" aria-hidden="true">◉</span>
                      <span
                        className={`cc-think-caret${thinkingOpen ? ' open' : ''}`}
                        aria-hidden="true"
                      />
                      {isActive
                        ? '正在思考'
                        : event.durationMs != null
                          ? `${title} (${(event.durationMs / 1000).toFixed(1)}s)`
                          : `${title}（时长未记录）`}
                    </button>
                    {thinkingOpen
                      ? <div className="cc-think-body">{event.text}</div>
                      : null}
                  </div>
                )
              }

              if (event.type === 'text') {
                return (
                  <div className="cc-process-text" key={event.id}>
                    <CcMarkdown text={event.text} />
                  </div>
                )
              }

              if (event.type === 'compact') {
                return <CompactionDivider key={event.id} compaction={event.compaction} />
              }

              const tool = event.tool
              const status = tool.status || (message.streaming ? 'running' : 'completed')
              return (
                <div className="cc-toolstrip" key={event.id}>
                  <button
                    type="button"
                    className="cc-toolchip"
                    onClick={() => setOpenToolId(tool.id)}
                  >
                    <span className="cc-tool-wrench" aria-hidden="true">⌁</span>
                    <span className="cc-toolchip-name">
                      调用工具：{shortToolName(tool.name)}
                    </span>
                    <span className={`cc-tool-status ${status}`}>
                      {toolStatusLabel(tool, Boolean(message.streaming))}
                    </span>
                    <span className="cc-tool-chevron" aria-hidden="true">›</span>
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* 正文：markdown。流式中末尾跟一个光标 */}
        {message.displaySegments?.length ? (
          <div className="cc-assistant-segments">
            {message.displaySegments.slice(0, visibleSegmentCount).map((segment, index) => {
              const isStreamingTail = Boolean(message.streaming) && index === message.displaySegments!.length - 1
              return (
                <div
                  className={`cc-bubble-assistant${segment.kind === 'text' ? ' cc-bubble-assistant-segment' : ''}${isStreamingTail ? ' streaming' : ''}`}
                  key={`${message.id}-segment-${index}`}
                >
                  <CcMarkdown text={segment.markdown} searchQuery={searchQuery} searchActive={searchActive} />
                  {isStreamingTail ? <span className="cc-caret" aria-hidden="true" /> : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className={`cc-bubble-assistant${message.streaming ? ' streaming' : ''}`}>
            {finalText ? (
              <CcMarkdown text={finalText} searchQuery={searchQuery} searchActive={searchActive} />
            ) : null}
            {message.streaming ? (
              finalText ? (
                <span className="cc-caret" aria-hidden="true" />
              ) : !message.thinking ? (
                <span className="cc-dots" aria-label="生成中">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null
            ) : null}
          </div>
        )}

        {message.nextWake ? (
          <div className="mt-1 text-[10.5px] text-[var(--color-text-tertiary)]">
            ↳ 下次唤醒 {shortClock(message.nextWake.at)}{message.nextWake.reason ? ` · ${message.nextWake.reason}` : ''}
          </div>
        ) : null}

        {/* 被停止的半截回复：在正文下方标一句，不跟完整回复混着看 */}
        {message.interrupted && !message.streaming ? (
          <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
            {message.interruptedReason === 'pro_limit' ? 'Pro 额度中断' : '已停止生成'}
          </div>
        ) : null}

        {!message.streaming && (message.engine || shownModel || message.deliveryNote) ? (
          <div className="relative mt-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-white/70 px-3 py-2 text-[10.5px] text-[var(--color-text-tertiary)]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {message.engine ? <span>引擎：{message.engine === 'selfhost' ? '自建' : 'cc'}</span> : null}
              {message.providerLabel ? <span>Provider：{message.providerLabel}</span> : null}
              {shownModel ? <span>模型：{shownModel}</span> : null}
              {message.context ? (
                <div ref={contextRef} className="static sm:relative">
                  <button
                    type="button"
                    aria-label="上下文详情"
                    aria-expanded={contextOpen}
                    title="上下文详情"
                    onClick={() => setContextOpen(open => !open)}
                    className="flex size-6 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.9 19a9 9 0 1 1 14.2 0" />
                      <path d="m12 14 3.5-3.5" />
                      <path d="M12 5v1.5M5 12h1.5M17.5 12H19" />
                    </svg>
                  </button>
                  {contextOpen ? (
                    <div
                      role="dialog"
                      aria-label="上下文详情"
                      className="absolute inset-x-3 top-full z-30 mt-1.5 w-auto rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-white p-3 text-[11px] text-[var(--color-text-tertiary)] shadow-lg sm:left-0 sm:right-auto sm:w-64"
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
            </div>
            {message.deliveryNote ? (
              <div className={`mt-1 ${message.deliveryState === 'saved' || message.deliveryState === 'replayed' ? 'text-emerald-700' : message.deliveryState === 'saving' ? 'text-[var(--color-primary)]' : 'text-rose-600'}`}>
                {message.deliveryNote}
              </div>
            ) : null}
            {message.deliveryState === 'persistence_unknown' && onRetryPersistence ? (
              <button
                type="button"
                onClick={() => onRetryPersistence(message)}
                className="mt-1.5 rounded-full border border-amber-300 px-2.5 py-1 text-amber-700 hover:bg-amber-50"
              >
                核对保存状态
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 行内操作：hover 才出。右边贴这一轮的 token 数，点开看明细 */}
        {!message.streaming && message.text ? (
          <div className="cc-row-actions flex items-center gap-3 pt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
            <button type="button" className="hover:text-[var(--color-text-secondary)]" onClick={() => onCopy(message.text)}>
              复制
            </button>
            {usage ? (
              <UsageTokenButton usage={usage} onClick={() => setUsageOpen(v => !v)} />
            ) : null}
          </div>
        ) : null}

        {/* token 明细。⚠️ 「缓存读」那部分是按 1/10 价计费的，别把它跟输入加起来看成花了多少钱 */}
        {usage && usageOpen ? <UsageDetails usage={usage} /> : null}
      </div>

      {openTool ? <CcToolDialog tool={openTool} onClose={() => setOpenToolId(null)} /> : null}
    </div>
  )
}
