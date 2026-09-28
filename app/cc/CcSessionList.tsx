'use client'
import CcSessionRail from './CcSessionRail'
import { historicalKey } from './historicalChats'
import type { CcChatScope } from './CcChatScope'

export default function CcSessionList({ scope, variant = 'rail' }: { scope: CcChatScope; variant?: 'rail' | 'mobile-page' }) {
  const { chat, activeHistorical, setMobileView, setActiveHistorical,
    stopSelecting, closeSearch, setHandoffOpen } = scope
  return (
    <CcSessionRail
      sessions={chat.sessions}
      deletedSessions={chat.deletedSessions}
      deletedSessionsTotal={chat.deletedSessionsTotal}
      deletedSessionsLoadingMore={chat.deletedSessionsLoadingMore}
      activeSessionId={activeHistorical ? '' : chat.sessionId}
      activeHistoricalKey={activeHistorical ? historicalKey(activeHistorical) : ''}
      loading={chat.sessionsLoading}
      onPick={id => {
        setMobileView('chat')
        setActiveHistorical(null)
        stopSelecting()
        void chat.switchSession(id)
      }}
      onPickHistorical={conversation => {
        setMobileView('chat')
        setActiveHistorical(conversation)
        stopSelecting()
        closeSearch()
      }}
      onNew={() => {
        setActiveHistorical(null)
        stopSelecting()
        setHandoffOpen({ fromSessionId: null })
      }}
      onRename={chat.renameSession}
      onPin={chat.pinSession}
      onDelete={async id => {
        const ok = await chat.deleteSession(id)
        if (ok && variant === 'mobile-page') setMobileView('list')
        return ok
      }}
      onPermanentDelete={chat.permanentlyDeleteSession}
      onLoadMoreDeleted={chat.loadMoreDeletedSessions}
      variant={variant}
      notice={chat.sessionActionNote}
    />
  )
}
