'use client'
import { useEffect, useRef, useState } from 'react'
import DetailPanel from '@/app/components/DetailPanel'
import { formatCost, formatTokens } from './format'
import { EFFORT_OPTIONS, modelsFor, prettyModelName } from './upstream'
import type { CcChatScope } from './CcChatScope'

export default function CcTopbar({ scope }: { scope: CcChatScope }) {
  const { chat, people, selectMode, stopSelecting, selectedMessageIds, setMobileView,
    setActiveHistorical, setPersonaRailOpen, setWinSetOpen, setHistoryDateOpen,
    setSettingsFor } = scope
  const { shownProvider, shownModel, ctxTokens, ctxMax, cacheLabel } = scope.metrics
  const [menuOpen, setMenuOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])
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
          className={`${selectMode ? 'hidden' : ''} flex size-11 shrink-0 items-center justify-center rounded-full text-lg text-[var(--color-text-secondary)] md:hidden`}>‹</button>
        <button type="button" onClick={() => setPersonaRailOpen(true)} title="切换协作者"
          className={`${selectMode ? 'hidden' : 'flex'} shrink-0 items-center`}>
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--color-primary)] font-[family-name:var(--font-display)] text-sm font-semibold text-[var(--color-on-primary)]" aria-hidden="true">{people.active.initial}</span>
        </button>
        <div className={`${selectMode ? 'hidden' : ''} min-w-0 flex-1`}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-[family-name:var(--font-display)] text-md font-semibold text-[var(--color-text-heading)]">{people.active.name}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold tracking-[var(--label-tracking)] ${mode === 'CHAT' ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]'}`}>{mode}</span>
          </div>
          <button type="button" onClick={() => !selfhost && setQuickOpen(true)} disabled={selfhost}
            className="block max-w-full truncate text-left text-2xs text-[var(--color-text-tertiary)] disabled:cursor-default"
            title={selfhost ? '自建引擎' : '快速切换模型和力度'}>
            {selfhost ? `${(shownProvider || '自建').slice(0, 8)} · ${model || '默认模型'}` : `${channel.slice(0, 8)} · ${model || '默认模型'}${effortLabel ? ` · ${effortLabel}` : ''}`}
          </button>
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
          <div ref={menuRef} className="relative">
            <button type="button" aria-label="更多聊天选项" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)} className="cc-icon-btn flex size-11 items-center justify-center text-lg">···</button>
            {menuOpen ? <div className="cc-popmenu absolute right-0 top-full z-50 mt-1 flex w-48 flex-col p-1">
              <button type="button" className="cc-popmenu-item w-full truncate text-left" onClick={() => {
                setMenuOpen(false)
                const title = window.prompt('修改窗口标题', chat.sessionTitle === '新对话' ? '' : chat.sessionTitle)
                if (title?.trim()) void chat.renameSession(chat.sessionId, title)
              }}>{chat.sessionTitle || '新对话'} ✎</button>
              <button type="button" className="cc-popmenu-item w-full text-left" onClick={() => { setMenuOpen(false); setWinSetOpen(true) }}>本窗设置</button>
              <button type="button" className="cc-popmenu-item w-full text-left" onClick={() => { setMenuOpen(false); setSettingsFor(people.active) }}>提示词</button>
            </div> : null}
          </div>
        </div>
      </div>
      <DetailPanel open={quickOpen} onClose={() => setQuickOpen(false)} mode="modal" width="max-w-sm">
        <div className="p-5">
          <h2 className="text-lg text-[var(--color-text-heading)]">模型快切</h2>
          <div className="mt-4 text-meta text-[var(--color-text-tertiary)]">模型</div>
          <select className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" value={chat.pick.model} onChange={event => void chat.applyPick({ model: event.target.value })}>
            {models.map(value => <option key={value} value={value}>{prettyModelName(value)}</option>)}
          </select>
          <div className="mt-4 text-meta text-[var(--color-text-tertiary)]">力度</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {EFFORT_OPTIONS.map(option => <button key={option.id} type="button" onClick={() => void chat.applyPick({ effort: option.id })} className={`rounded-full border px-2 py-1 text-meta ${chat.pick.effort === option.id ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>{option.id === 'xhigh' ? 'XHigh' : option.id[0].toUpperCase() + option.id.slice(1)}</button>)}
          </div>
        </div>
      </DetailPanel>
    </>
  )
}
