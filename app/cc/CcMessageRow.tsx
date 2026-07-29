'use client'
import { useEffect, useRef, useState } from 'react'
import CcMarkdown from './CcMarkdown'
import CcToolDialog from './CcToolDialog'
import { FALLBACK_PERSONA, type CcPersona } from './persona'
import type { CcMessage, CcProcessEvent, CcToolEvent } from './types'

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
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function shortToolName(name: string) {
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
  /** 当前选中的协作者，只用来画名字行的头像和名字 */
  persona?: CcPersona
  onCopy: (text: string) => void
  onEditAndResend?: (text: string) => void
  onOpenRecall?: (message: CcMessage) => void
}

export default function CcMessageRow({
  message,
  persona: personaProp,
  onCopy,
  onEditAndResend,
  onOpenRecall,
}: Props) {
  const isUser = message.role === 'user'
  const [menuOpen, setMenuOpen] = useState(false)
  // 默认展开。流式中跟着输出，结束后不自动收 —— 只有用户点了才收。
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  // 这一轮的 token 明细，默认收着
  const [usageOpen, setUsageOpen] = useState(false)
  const timerRef = useRef<number | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (e: PointerEvent) => {
      if (e.target instanceof Node && frameRef.current?.contains(e.target)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [menuOpen])

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

        {/* Thinking 与工具按真实发生顺序展示，最终回答固定放在过程区之后。 */}
        {process.length > 0 ? (
          <div className="cc-process">
            {process.map((event, index) => {
              if (event.type === 'thinking') {
                const thinkingIndex =
                  process.slice(0, index).filter(item => item.type === 'thinking').length
                const isActive =
                  Boolean(message.streaming) &&
                  index === process.length - 1 &&
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
                          : `${title} ${event.text.length} 字`}
                    </button>
                    {thinkingOpen
                      ? <div className="cc-think-body">{event.text}</div>
                      : null}
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
          {message.text ? <CcMarkdown text={message.text} /> : null}
          {message.streaming ? (
            message.text ? (
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
