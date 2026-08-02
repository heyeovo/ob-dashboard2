'use client'
import { useEffect, useRef, useState } from 'react'
import CcMarkdown from './CcMarkdown'
import CcToolDialog from './CcToolDialog'
import { FALLBACK_PERSONA, type CcPersona } from './persona'
import type { CcMessage, CcProcessEvent, CcToolEvent } from './types'
import { modelLabel } from './upstream'

// 一条消息。
//
// 用户侧：实心气泡贴右，纯文本（用户说的话不当 markdown 解析）。长按 360ms / 右键出菜单。
// 助手侧：名字行（头像 + persona 名 + 时间 + 最右召回按钮）→ thinking / 工具过程 → 正文。
//
// thinking 的行为（跟 Polaris 不同，用户明确要的）：
//   流式中自动展开跟着输出，答完**保持展开**，只能手动收起。
//   Polaris 那边答完自动收起，这里不要。

const LONG_PRESS_MS = 360

/** token 明细里的数字：等宽对齐，不加粗到抢眼 */
const USAGE_NUM = 'font-medium tabular-nums text-[var(--color-text-secondary)]'

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
}

export default function CcMessageRow({
  message,
  isCurrentTurn,
  persona: personaProp,
  onCopy,
  onEditAndResend,
  onOpenRecall,
  onRetryPersistence,
}: Props) {
  const isUser = message.role === 'user'
  const shownModel = modelLabel(message.model || '')
  const [menuOpen, setMenuOpen] = useState(false)
  // 新生成的当前轮默认展开；从 Haven 读回的历史轮默认折叠。
  // 状态只属于当前页面：实时轮结束后保持展开，刷新后会按历史规则重新折叠。
  const [thinkingOpen, setThinkingOpen] = useState(isCurrentTurn && !message.fromHistory)
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  // 这一轮的 token 明细，默认收着
  const [usageOpen, setUsageOpen] = useState(false)
  // 上下文预算是诊断信息，收进图标浮窗，避免元数据行过长。
  const [contextOpen, setContextOpen] = useState(false)
  const timerRef = useRef<number | null>(null)
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

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const clearTimer = () => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const openMenu = () => {
    if (!isUser || message.fromHistory) return
    setMenuOpen(true)
  }

  /* ---------- 用户侧 ---------- */
  if (isUser) {
    return (
      <div className="cc-row flex flex-col gap-1" data-role="user">
        <div ref={frameRef} className="flex flex-col items-end">
          <div
            className="cc-bubble-user"
            onContextMenu={e => {
              if (message.fromHistory) return
              e.preventDefault()
              openMenu()
            }}
            onPointerDown={e => {
              if (e.pointerType === 'mouse') return
              clearTimer()
              timerRef.current = window.setTimeout(() => {
                timerRef.current = null
                openMenu()
              }, LONG_PRESS_MS)
            }}
            onPointerUp={clearTimer}
            onPointerCancel={clearTimer}
            onPointerMove={clearTimer}
            onPointerLeave={clearTimer}
          >
            {message.text}
          </div>

          {menuOpen ? (
            <div className="cc-popmenu mt-2 flex gap-1">
              <button
                type="button"
                className="cc-popmenu-item"
                onClick={() => {
                  onCopy(message.text)
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
                    onEditAndResend(message.text)
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
    )
  }

  /* ---------- 助手侧 ---------- */
  // 历史消息不记「当时是谁回的」，一律按当前协作者显示。要按轮存 persona 是以后的事。
  const persona = personaProp || FALLBACK_PERSONA
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
  // 5.2 之前的老消息没有 usage，那就不显示（不编 0）
  const usage = message.usage || null

  return (
    <div className="cc-row flex flex-col" data-role="assistant">
      <div className="cc-assistant-block">
        {/* 名字行：头像 + 名字 + 时间，最右是这一轮的召回按钮 */}
        <div className="cc-namerow">
          <span className="cc-avatar" style={{ background: persona.tint }} aria-hidden="true">
            {persona.initial}
          </span>
          <span className="cc-name">{persona.name}</span>
          <span className="cc-time">{formatTime(message.createdAt)}</span>
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
        <div className={`cc-bubble-assistant${message.streaming ? ' streaming' : ''}`}>
          {finalText ? <CcMarkdown text={finalText} /> : null}
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

        {/* 被停止的半截回复：在正文下方标一句，不跟完整回复混着看 */}
        {message.interrupted && !message.streaming ? (
          <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">已停止生成</div>
        ) : null}

        {!message.streaming && (message.engine || shownModel || message.deliveryNote) ? (
          <div className="mt-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-white/70 px-3 py-2 text-[10.5px] text-[var(--color-text-tertiary)]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {message.engine ? <span>引擎：{message.engine === 'selfhost' ? '自建' : 'cc'}</span> : null}
              {message.providerLabel ? <span>Provider：{message.providerLabel}</span> : null}
              {shownModel ? <span>模型：{shownModel}</span> : null}
              {message.context ? (
                <div ref={contextRef} className="relative">
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
                      className="absolute right-0 top-full z-30 mt-1.5 w-64 max-w-[calc(100dvw-2rem)] rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-white p-3 text-[11px] text-[var(--color-text-tertiary)] shadow-lg sm:left-0 sm:right-auto"
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
              <button
                type="button"
                className="ml-auto tabular-nums hover:text-[var(--color-text-secondary)]"
                onClick={() => setUsageOpen(v => !v)}
                title="这一轮的 token 用量"
              >
                {(usage.inputTokens + usage.cacheReadTokens + usage.outputTokens).toLocaleString()} tok
              </button>
            ) : null}
          </div>
        ) : null}

        {/* token 明细。⚠️ 「缓存读」那部分是按 1/10 价计费的，别把它跟输入加起来看成花了多少钱 */}
        {usage && usageOpen ? (
          <div className="mt-1 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] px-3 py-2">
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
                    {' '}
                    (1h {usage.cacheWrite1hTokens.toLocaleString()} · 5m{' '}
                    {usage.cacheWrite5mTokens.toLocaleString()})
                  </span>
                ) : null}
              </b>
              {usage.durationMs ? (
                <>
                  <span>时长</span>
                  <b className={USAGE_NUM}>{(usage.durationMs / 1000).toFixed(1)}s</b>
                </>
              ) : null}
              {usage.tokensPerSec ? (
                <>
                  <span>速度</span>
                  <b className={USAGE_NUM}>{usage.tokensPerSec.toFixed(1)} tok/s</b>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {openTool ? <CcToolDialog tool={openTool} onClose={() => setOpenToolId(null)} /> : null}
    </div>
  )
}
