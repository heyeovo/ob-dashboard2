'use client'
import CcHistoricalChat from './CcHistoricalChat'
import { historicalKey } from './historicalChats'
import CcTopbar from './CcTopbar'
import CcMessageStream from './CcMessageStream'
import CcSessionList from './CcSessionList'
import CcChatComposer from './CcChatComposer'
import CcChatOverlays from './CcChatOverlays'
import type { CcChatScope } from './CcChatScope'

export default function CcChatView({ scope }: { scope: CcChatScope }) {
  const { people, activeHistorical, setActiveHistorical, setForwardedBlock,
    setMobileView, mobileView, mobilePageRef, mobileComposerRef } = scope
  return (
    <>
      {/* 桌面端：左会话列表 + 右对话（导航是全局左侧竖栏，这一页不带顶部横条） */}
      <div className="cc-page hidden h-screen flex-col md:flex">
        <div className="flex min-h-0 flex-1">
          <aside className="cc-rail-pane w-[var(--chat-rail-width)] shrink-0"><CcSessionList scope={scope} /></aside>
          <main className="flex min-w-0 flex-1 flex-col">
            {activeHistorical ? (
              <CcHistoricalChat
                key={historicalKey(activeHistorical)}
                conversation={activeHistorical}
                persona={people.active}
                onOpenRail={() => setMobileView('list')}
                onForward={block => { setForwardedBlock(block); setActiveHistorical(null) }}
              />
            ) : (
              <>
                <CcTopbar scope={scope} />
                <CcMessageStream scope={scope} />
                <CcChatComposer scope={scope} />
              </>
            )}
          </main>
        </div>
      </div>

      {/* 手机端：默认对话列表，点进窗口后才显示聊天。 */}
      <div
        ref={mobilePageRef}
        className={`cc-page cc-mobile-surface flex flex-col md:hidden ${mobileView === 'chat' && !activeHistorical ? 'cc-mobile-thread' : ''}`}
      >
        {mobileView === 'list' ? <CcSessionList scope={scope} variant="mobile-page" /> : activeHistorical ? (
          <CcHistoricalChat
            key={historicalKey(activeHistorical)}
            conversation={activeHistorical}
            persona={people.active}
            onOpenRail={() => setMobileView('list')}
            onForward={block => { setForwardedBlock(block); setActiveHistorical(null) }}
          />
        ) : (
          <>
            <CcTopbar scope={scope} />
            <CcMessageStream scope={scope} />
            <div ref={mobileComposerRef} className="cc-mobile-composer-layer"><CcChatComposer scope={scope} /></div>
          </>
        )}
      </div>

      <CcChatOverlays scope={scope} />
    </>
  )
}
