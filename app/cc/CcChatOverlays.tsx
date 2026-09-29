'use client'
import CcPersonaDialog from './CcPersonaDialog'
import CcPersonaRail from './CcPersonaRail'
import CcRecallDialog from './CcRecallDialog'
import CcWindowSettings from './CcWindowSettings'
import CcHandoffDialog from './CcHandoffDialog'
import CcChatCalendar from './CcChatCalendar'
import { draftPersona } from './persona'
import type { CcChatScope } from './CcChatScope'

export default function CcChatOverlays({ scope }: { scope: CcChatScope }) {
  const { chat, people, personaRailOpen, setPersonaRailOpen, settingsFor, setSettingsFor,
    winSetOpen, setWinSetOpen, historyDateOpen, setHistoryDateOpen,
    handoffOpen, setHandoffOpen, recallDetail, setRecallDetail,
    pendingForward, setPendingForward, stopSelecting, confirmForwardTo,
    setMobileView } = scope
  const { displayStats, totalChars, conversationText, systemPromptText, shownProvider,
    shownModel, ctxTokens, ctxMax } = scope.metrics
  // 协作者列表：桌面端和手机端都是从左侧盖上来的浮层。
  // 桌面端左边那栏是会话列表，两个东西不能抢同一个位置。
  const personaRail = personaRailOpen ? (
    <div className="cc-mobile-overlay-clearance fixed inset-x-0 top-0 z-40 md:inset-0">
      <button
        type="button"
        aria-label="关闭协作者列表"
        onClick={() => setPersonaRailOpen(false)}
        className="absolute inset-0 bg-[var(--color-overlay)]/20"
      />
      <div className="absolute left-0 top-0 h-full w-[78%] max-w-[300px] float-surface shadow-xl">
        <CcPersonaRail
          personas={people.personas}
          activeId={people.activeId}
          loading={people.loading}
          onPick={id => {
            setPersonaRailOpen(false)
            if (id === people.activeId) return
            people.selectPersona(id)
            // 换人 = 换一整套对话。开着的那个属于上一个协作者，留在屏幕上会串，
            // 直接开一个新的空对话。
            chat.startNewSession()
          }}
          onNew={() => {
            setPersonaRailOpen(false)
            setSettingsFor(draftPersona())
          }}
          onClose={() => setPersonaRailOpen(false)}
        />
      </div>
    </div>
  ) : null
  return (
    <>
      {personaRail}
      {settingsFor ? (
        <CcPersonaDialog
          // key = 换人就整个重挂，弹窗内部的草稿跟着重取
          key={settingsFor.id}
          persona={settingsFor}
          canDelete={people.personas.length > 1 && people.personas.some(p => p.id === settingsFor.id)}
          saving={people.saving}
          onSave={async persona => {
            const res = await people.savePersona(persona)
            // 新建的：保存成功就切过去
            if (res.ok && res.persona) {
              people.selectPersona(res.persona.id)
              setSettingsFor(res.persona)
            }
            return { ok: res.ok }
          }}
          onDelete={people.deletePersona}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}

      {people.error ? (
        <div className="cc-persona-error">{people.error}</div>
      ) : null}

      {/* 本窗口设置：只管这一个对话。模型/力度/思考当场生效，供应商要新建对话 */}
      {winSetOpen ? (
        <CcWindowSettings
          sessionId={chat.sessionId}
          personaId={people.active.id}
          stats={displayStats}
          totalChars={totalChars}
          conversationText={conversationText}
          systemPromptText={systemPromptText}
          activeProvider={shownProvider}
          activeModel={shownModel}
          contextTokens={ctxTokens}
          contextMaxTokens={ctxMax}
          upstream={chat.upstream}
          pick={chat.pick}
          proUsage={chat.proUsage}
          onRefreshProUsage={() => void chat.refreshProUsage()}
          onPick={next => void chat.applyPick(next)}
          web={chat.webSettings}
          onWebChange={chat.applyWebSettings}
          onSaveWebDefaults={() => void chat.saveWebDefaults()}
          webSaving={chat.webSaving}
          engine={chat.effectiveEngine}
          onEngineChange={engine => {
            const chooseMode = engine === 'cc' && chat.effectiveEngine === 'selfhost' && !chat.modeLocked
            void chat.changeEngine(engine)
            if (chooseMode) setWinSetOpen(true)
          }}
          engineDisabled={chat.isRemote === true || chat.engineSaving || chat.sending}
          mode={chat.mode}
          onModeChange={chat.setMode}
          modeLocked={chat.modeLocked}
          providerLocked={chat.providerLocked}
          webLocked={chat.modeLocked}
          note={chat.settingsNote}
          onCompact={chat.compactNow}
          onHandoff={() => {
            setWinSetOpen(false)
            setHandoffOpen({ fromSessionId: chat.sessionId })
          }}
          onClose={() => {
            setWinSetOpen(false)
            chat.setSettingsNote('')
          }}
        />
      ) : null}

      <CcChatCalendar open={historyDateOpen} sessionId={chat.sessionId}
        onClose={() => setHistoryDateOpen(false)}
        onPick={async day => {
          const found = await chat.loadHistoryDay(day)
          if (found) window.setTimeout(() => document.getElementById(`chat-day-${day}`)?.scrollIntoView({ block: 'start' }), 50)
          return found
        }} />

      {/* 换窗 / 新对话弹窗 */}
      {handoffOpen ? (
        <CcHandoffDialog
          fromSessionId={handoffOpen.fromSessionId}
          currentMode={chat.mode}
          personaId={people.active.id}
          onConfirm={payload => {
            setHandoffOpen(null)
            chat.startWithHandoff(payload)
            setMobileView('chat')
          }}
          onClose={() => setHandoffOpen(null)}
        />
      ) : null}

      {/* 召回详情：按模块分段。⚠️ 各模块的正文服务端还没回传（见组件内注释） */}
      {recallDetail ? (
        <CcRecallDialog message={recallDetail} onClose={() => setRecallDetail(null)} />
      ) : null}

      {/* 转发目标选择 */}
      {pendingForward ? (
        <div className="cc-modal-scrim fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="取消转发"
            onClick={() => { setPendingForward(null); stopSelecting() }}
            className="absolute inset-0"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="选择转发目标"
            className="cc-modal cc-tool-sheet relative flex max-h-[70vh] w-full max-w-md flex-col"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--color-overlay)]/10 sm:hidden" />
            <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-5 py-4">
              <h2 className="text-md font-semibold text-[var(--color-text-heading)]">
                转发到…
              </h2>
              <button
                type="button"
                onClick={() => { setPendingForward(null); stopSelecting() }}
                className="text-meta text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              >
                取消
              </button>
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1">
                {chat.sessions
                  .filter(s => !s.deleted_at)
                  .map(s => (
                    <button
                      key={s.session_id}
                      type="button"
                      onClick={() => confirmForwardTo(s.session_id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-secondary)] ${s.session_id === chat.sessionId ? 'bg-[var(--color-primary-soft)]' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-note font-medium text-[var(--color-text-primary)]">
                          {s.title || '新对话'}
                        </div>
                        <div className="mt-0.5 text-2xs text-[var(--color-text-disabled)]">
                          {s.turn_count} 轮
                          {s.session_id === chat.sessionId ? ' · 当前窗口' : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm text-[var(--color-text-tertiary)]" aria-hidden="true">›</span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="border-t border-[var(--color-border-light)] px-5 py-3 text-center text-2xs text-[var(--color-text-disabled)]">
              已选 {pendingForward.lines.length} 条消息
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
