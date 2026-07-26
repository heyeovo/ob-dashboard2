'use client'
import { useEffect, useRef, useState } from 'react'
import CcMarkdown from './CcMarkdown'
import CcToolDialog from './CcToolDialog'
import { FALLBACK_PERSONA, type CcPersona } from './persona'
import type { CcMessage, CcToolEvent } from './types'

// 一条消息。
//
// 用户侧：实心气泡贴右，纯文本（用户说的话不当 markdown 解析）。长按 360ms / 右键出菜单。
// 助手侧：名字行（头像 + persona 名 + 时间 + 最右召回按钮）→ thinking → 正文 → 工具框。
//
// thinking 的行为（跟 Polaris 不同，用户明确要的）：
//   流式中自动展开跟着输出，答完**保持展开**，只能手动收起。
//   Polaris 那边答完自动收起，这里不要。

const LONG_PRESS_MS = 360

function formatTime(ms: number) {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
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
  const [openTool, setOpenTool] = useState<CcToolEvent | null>(null)
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
  const tools = message.tools || []

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

        {/* thinking：流式中跟着输出，答完保持展开 */}
        {message.thinking ? (
          <div className="cc-think">
            <button type="button" className="cc-think-toggle" onClick={() => setThinkingOpen(v => !v)}>
              <span className={`cc-think-caret${thinkingOpen ? ' open' : ''}`} aria-hidden="true" />
              {message.streaming && !message.text ? '正在思考' : `思考 ${message.thinking.length} 字`}
            </button>
            {thinkingOpen ? <div className="cc-think-body">{message.thinking}</div> : null}
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

        {/* 工具调用：一行一个框，点开看参数和结果 */}
        {tools.length > 0 ? (
          <div className="cc-toolstrip">
            {tools.map(tool => (
              <button key={tool.id} type="button" className="cc-toolchip" onClick={() => setOpenTool(tool)}>
                <span className="cc-tool-dot" />
                <span className="cc-toolchip-name">{tool.name}</span>
                <span className="cc-toolchip-hint">查看</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* 行内操作：hover 才出 */}
        {!message.streaming && message.text ? (
          <div className="cc-row-actions flex items-center gap-3 pt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
            <button type="button" className="hover:text-[var(--color-text-secondary)]" onClick={() => onCopy(message.text)}>
              复制
            </button>
          </div>
        ) : null}
      </div>

      {openTool ? <CcToolDialog tool={openTool} onClose={() => setOpenTool(null)} /> : null}
    </div>
  )
}
