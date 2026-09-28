'use client'
import { MODE_LABEL } from '@/app/lib/ccModes'
import { formatCost, formatTokens } from './format'
import type { CcChatScope } from './CcChatScope'

export default function CcTopbar({ scope }: { scope: CcChatScope }) {
  const { chat, people, selectMode, stopSelecting, selectedMessageIds, setMobileView,
    setActiveHistorical, setPersonaRailOpen, setSearchSessionId, setSearchQuery,
    setActiveSearchMessageId, setSearchOpen, setWinSetOpen, setHistoryDateOpen,
    setSettingsFor, startSelecting } = scope
  const { shownProvider, shownModel, contextSnapshot, ctxTokens, ctxMax, cacheLabel } = scope.metrics
  return (
    <div className="cc-topbar flex items-center gap-2 px-3 py-2.5 md:gap-3 md:px-4">
      {selectMode ? (
        <div className="flex min-w-0 flex-1 items-center justify-between md:hidden">
          <button type="button" onClick={stopSelecting} className="rounded-full px-2 py-1 text-xs text-[var(--color-text-secondary)]">
            取消
          </button>
          <span className="text-xs font-medium text-[var(--color-text-primary)]">已选 {selectedMessageIds.size} 条</span>
          <span className="w-10" aria-hidden="true" />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setMobileView('list')
          setActiveHistorical(null)
          stopSelecting()
        }}
        aria-label="返回对话列表"
        className={`${selectMode ? 'hidden' : ''} rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] md:hidden`}
      >
        ←
      </button>
      {/* 左：当前协作者，点开换人 */}
      <button
        type="button"
        onClick={() => setPersonaRailOpen(true)}
        className={`${selectMode ? 'hidden md:flex' : ''} cc-persona-chip`}
        title="切换协作者"
      >
        <span className="cc-avatar" style={{ background: people.active.tint }} aria-hidden="true">
          {people.active.initial}
        </span>
        {/* 手机上只留头像，名字省掉 —— 顶栏横向就那么点地方 */}
        <span className="hidden max-w-[7rem] truncate md:inline">{people.active.name}</span>
      </button>
      <div className={`${selectMode ? 'hidden md:block' : ''} min-w-0 flex-1`}>
        <button
          type="button"
          title="点击修改窗口标题"
          onClick={() => {
            const title = window.prompt('修改窗口标题', chat.sessionTitle === '新对话' ? '' : chat.sessionTitle)
            if (title?.trim()) void chat.renameSession(chat.sessionId, title)
          }}
          className="block max-w-full truncate text-left text-note font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
        >
          {chat.sessionTitle}
        </button>
        <div className="mt-0.5 whitespace-nowrap text-meta text-[var(--color-text-disabled)] md:hidden">
          {chat.effectiveEngine === 'selfhost' ? '纯聊天' : `${MODE_LABEL[chat.mode]}模式`}
        </div>
        {/* 完整运行信息只在桌面显示；手机去「本窗」查看，避免顶栏拥挤。 */}
        <div className="mt-0.5 hidden items-center gap-x-2 overflow-hidden whitespace-nowrap text-meta text-[var(--color-text-disabled)] md:flex">
          <span>{chat.effectiveEngine === 'selfhost' ? '纯聊天' : `${MODE_LABEL[chat.mode]}模式`}</span>
          <span>·</span>
          <span>{chat.latestTurn?.engine === 'selfhost' || (!chat.latestTurn && chat.effectiveEngine === 'selfhost') ? '自建引擎' : 'cc'}</span>
          {shownProvider ? <><span>·</span><span>{shownProvider}</span></> : null}
          {shownModel ? (
            <>
              <span>·</span>
              <span className="max-w-[11rem] truncate" title={shownModel}>
                {shownModel}
              </span>
            </>
          ) : null}
          <span>·</span>
          <span>{chat.stats.turnCount} 轮</span>
          {chat.effectiveEngine === 'cc' ? (
            <>
              <span>·</span>
              <span title={contextSnapshot ? '最近一次真实模型请求确认的当前窗口 Context' : '下一次真实模型调用后确认'}>
                {chat.stats.compacting
                  ? 'Context 压缩中'
                  : ctxTokens > 0
                    ? `${formatTokens(ctxTokens)}${ctxMax > 0 ? ` / ${formatTokens(ctxMax)}` : ''}`
                    : 'Context 待确认'}
              </span>
            </>
          ) : null}
          {/* 花费只在这个进程还活着时显示。读回来的历史算不出钱 ——
              不同中转站、不同模型价格不一样，要一张价格表，见 HANDOFF 待办。
              这时候显示 $0 是在骗人，不如不显示。 */}
          {chat.stats.totalCostUsd > 0 && chat.pick.kind !== 'subscription' ? (
            <>
              <span>·</span>
              <span>{formatCost(chat.stats.totalCostUsd)}</span>
            </>
          ) : null}
          {chat.effectiveEngine === 'cc' ? (
            <>
              <span>·</span>
              <span
                title="Anthropic prompt cache 两档：系统提示 + 工具说明进 1 小时档，会话消息进 5 分钟档。5 分钟过了不等于缓存全没，接着聊仍然便宜。"
              >
                {cacheLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {/* 右：本窗口设置（这一个对话的模型/供应商）+ 协作者设置（跨对话的人设） */}
      <div className={`${selectMode ? 'hidden md:flex' : 'flex'} shrink-0 items-center gap-1 md:gap-2`}>
        <button
          type="button"
          onClick={() => selectMode ? stopSelecting() : startSelecting()}
          className="hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-2xs text-[var(--color-text-tertiary)] md:inline-flex"
        >
          {selectMode ? '取消选择' : '选择'}
        </button>
        <button
          type="button"
          onClick={() => selectMode ? stopSelecting() : startSelecting()}
          aria-label={selectMode ? '取消选择' : '选择消息'}
          title={selectMode ? '取消选择' : '选择消息'}
          className="cc-icon-btn md:hidden"
        >
          {selectMode ? (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setSearchSessionId(chat.sessionId)
            setSearchQuery('')
            setActiveSearchMessageId('')
            setSearchOpen(true)
          }}
          aria-label="搜索当前对话"
          title="搜索当前对话"
          className="cc-icon-btn hidden md:flex"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.3" />
            <path d="m15.5 15.5 4 4" />
          </svg>
        </button>
        <div className="flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-2xs">
          {(['cc', 'selfhost'] as const).map(engine => (
            <button
              key={engine}
              type="button"
              disabled={chat.isRemote === true || chat.engineSaving || chat.sending}
              onClick={() => {
                const shouldChooseMode =
                  engine === 'cc' && chat.effectiveEngine === 'selfhost' && !chat.modeLocked
                void chat.changeEngine(engine)
                if (shouldChooseMode) setWinSetOpen(true)
              }}
              className={`rounded-full px-2 py-1 ${chat.effectiveEngine === engine ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'} disabled:cursor-not-allowed disabled:opacity-55`}
              title={chat.isRemote === true ? 'Vercel 环境仅支持自建引擎，本地首选不会被覆盖' : `切换到 ${engine === 'cc' ? 'cc' : '自建引擎'}`}
            >
              {engine === 'cc' ? 'cc' : '自建'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setHistoryDateOpen(true)}
          aria-label="按日期查看历史消息"
          title="按日期查看历史消息"
          className="cc-icon-btn"
        >
          历史
        </button>
        <button
          type="button"
          onClick={() => setWinSetOpen(true)}
          aria-label="本窗口设置"
          title="本窗口设置：模型 / 力度 / 供应商"
          className="cc-icon-btn"
        >
          本窗
        </button>
        <button
          type="button"
          onClick={() => setSettingsFor(people.active)}
          aria-label="协作者设置"
          title="协作者设置"
          className="cc-icon-btn"
        >
          设置
        </button>
      </div>
    </div>
  )
}
