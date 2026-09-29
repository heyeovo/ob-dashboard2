'use client'
import { useEffect, useRef, useState } from 'react'
import { formatCost, formatTokens } from './format'
import { EFFORT_OPTIONS, modelsFor, prettyModelName } from './upstream'
import type { CcChatScope } from './CcChatScope'

export default function CcTopbar({ scope }: { scope: CcChatScope }) {
  const { chat, people, selectMode, stopSelecting, selectedMessageIds, setMobileView,
    setActiveHistorical, setPersonaRailOpen, setWinSetOpen, setHistoryDateOpen } = scope
  const { shownProvider, shownModel, ctxTokens, ctxMax, cacheLabel } = scope.metrics
  const [quickOpen, setQuickOpen] = useState(false)
  const quickRef = useRef<HTMLDivElement>(null)
  // 模型快切下拉点外面收起
  useEffect(() => {
    if (!quickOpen) return
    const close = (event: PointerEvent) => {
      if (!quickRef.current?.contains(event.target as Node)) setQuickOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [quickOpen])
  const selfhost = chat.effectiveEngine === 'selfhost'
  const mode = selfhost ? '自建' : chat.mode === 'work' ? 'WORK' : 'CHAT'
  const channel = chat.pick.kind === 'subscription' ? 'Pro' : shownProvider || 'API'
  const model = prettyModelName(chat.pick.model || shownModel || '')
  const effort = chat.pick.effort
  const effortLabel = effort === 'xhigh' ? 'XHigh' : effort ? effort[0].toUpperCase() + effort.slice(1) : ''
  const models = modelsFor(chat.upstream, chat.pick.kind, chat.pick.providerId)
  return (
    <>
      <div className="cc-topbar flex min-w-0 items-center gap-2 px-3 py-2 md:gap-3 md:px-4">
        {selectMode ? (
          <div className="flex min-w-0 flex-1 items-center justify-between">
            <button type="button" onClick={stopSelecting} className="min-h-11 px-2 text-xs text-[var(--color-text-secondary)]">取消</button>
            <span className="text-xs font-medium">已选 {selectedMessageIds.size} 条</span>
            <span className="w-10" aria-hidden="true" />
          </div>
        ) : null}
        <button type="button" aria-label="返回对话列表"
          onClick={() => { setMobileView('list'); setActiveHistorical(null); stopSelecting() }}
          className={`${selectMode ? 'hidden' : ''} -mx-2 flex size-11 shrink-0 items-center justify-center text-[var(--color-text-secondary)] md:hidden`}>
          {/* 点击范围 44px，负外边距让它在布局里只占约 28px */}
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>
        </button>
        <button type="button" onClick={() => setPersonaRailOpen(true)} title="切换协作者"
          className={`${selectMode ? 'hidden' : 'flex'} shrink-0 items-center`}>
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--color-primary)] font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--color-on-primary)]" aria-hidden="true">{people.active.initial}</span>
        </button>
        <div className={`${selectMode ? 'hidden' : ''} min-w-0 flex-1`}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-[family-name:var(--font-display)] text-md font-semibold text-[var(--color-text-heading)]">{people.active.name}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold tracking-[var(--label-tracking)] ${mode === 'CHAT' ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]'}`}>{mode}</span>
          </div>
          <div ref={quickRef} className="relative max-w-full">
            <button type="button" onClick={() => !selfhost && setQuickOpen(open => !open)} disabled={selfhost}
              aria-expanded={quickOpen} aria-haspopup="menu"
              className="flex max-w-full items-center gap-0.5 text-left text-2xs text-[var(--color-text-tertiary)] disabled:cursor-default"
              title={selfhost ? '自建引擎' : '切换模型和力度'}>
              <span className="truncate">
                {selfhost ? `${(shownProvider || '自建').slice(0, 8)} · ${model || '默认模型'}` : `${channel.slice(0, 8)} · ${model || '默认模型'}${effortLabel ? ` · ${effortLabel}` : ''}`}
              </span>
              {selfhost ? null : <span className={`cc-fold-caret down${quickOpen ? ' open' : ''}`} aria-hidden="true" />}
            </button>
            {quickOpen ? (
              <div className="cc-popmenu absolute left-0 top-full z-50 mt-1.5 flex w-60 flex-col p-1" role="menu">
                <div className="px-2.5 pb-1 pt-1.5 text-3xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-disabled)]">Model</div>
                {models.map(value => (
                  <button key={value} type="button" role="menuitemradio" aria-checked={chat.pick.model === value}
                    onClick={() => { void chat.applyPick({ model: value }); setQuickOpen(false) }}
                    className="cc-popmenu-item flex w-full items-center justify-between gap-2 text-left">
                    <span className="truncate">{prettyModelName(value)}</span>
                    {chat.pick.model === value ? <span className="text-[var(--color-primary)]" aria-hidden="true">✓</span> : null}
                  </button>
                ))}
                <div className="px-2.5 pb-1 pt-2.5 text-3xs uppercase tracking-[var(--label-tracking)] text-[var(--color-text-disabled)]">Effort</div>
                <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                  {EFFORT_OPTIONS.map(option => (
                    <button key={option.id} type="button" onClick={() => void chat.applyPick({ effort: option.id })}
                      className={`rounded-full border px-2 py-1 text-meta ${chat.pick.effort === option.id ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>
                      {option.id === 'xhigh' ? 'XHigh' : option.id[0].toUpperCase() + option.id.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="hidden truncate whitespace-nowrap text-2xs text-[var(--color-text-disabled)] md:block">
            {chat.stats.turnCount} 轮 · {chat.stats.compacting ? 'Context 压缩中' : ctxTokens > 0 ? `${formatTokens(ctxTokens)}${ctxMax > 0 ? ` / ${formatTokens(ctxMax)}` : ''}` : 'Context 待确认'}
            {chat.stats.totalCostUsd > 0 && chat.pick.kind !== 'subscription' ? ` · ${formatCost(chat.stats.totalCostUsd)}` : ''}
            {chat.effectiveEngine === 'cc' ? ` · ${cacheLabel}` : ''}
          </div>
        </div>
        <div className={`${selectMode ? 'hidden' : 'flex'} shrink-0 items-center gap-1`}>
          <button type="button" aria-label="按日期查看历史消息" title="按日期查看历史消息" onClick={() => setHistoryDateOpen(true)} className="cc-icon-btn flex size-11 items-center justify-center">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3.5"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/></svg>
          </button>
          {/* 窗口名只读放进本窗设置「会话信息」，提示词在主页抽屉「言」卡片里，··· 直接开本窗设置 */}
          <button type="button" aria-label="本窗设置" title="本窗设置" onClick={() => setWinSetOpen(true)} className="cc-icon-btn flex size-11 items-center justify-center">
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
          </button>
        </div>
      </div>
    </>
  )
}
