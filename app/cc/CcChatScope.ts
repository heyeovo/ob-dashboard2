import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { CcMessage } from './types'
import type { HistoricalConversation } from './historicalChats'
import type { useCcChat } from './useCcChat'
import type { usePersonas } from './usePersonas'
import type { useXhsCard } from './useXhsCard'
import type { getCcChatMetrics } from './CcChatMetrics'

type Setter<T> = Dispatch<SetStateAction<T>>
export type ForwardBlock = { title: string; lines: string[] }
export type MobileView = 'list' | 'chat'
export type HandoffRequest = { fromSessionId: string | null }

export type CcChatScope = {
  chat: ReturnType<typeof useCcChat>
  people: ReturnType<typeof usePersonas>
  xhs: ReturnType<typeof useXhsCard>
  metrics: ReturnType<typeof getCcChatMetrics>
  mobileView: MobileView
  setMobileView: Setter<MobileView>
  mobilePageRef: RefObject<HTMLDivElement | null>
  mobileComposerRef: RefObject<HTMLDivElement | null>
  personaRailOpen: boolean
  setPersonaRailOpen: Setter<boolean>
  recallDetail: CcMessage | null
  setRecallDetail: Setter<CcMessage | null>
  winSetOpen: boolean
  setWinSetOpen: Setter<boolean>
  historyDateOpen: boolean
  setHistoryDateOpen: Setter<boolean>
  historyDate: string
  setHistoryDate: Setter<string>
  handoffOpen: HandoffRequest | null
  setHandoffOpen: Setter<HandoffRequest | null>
  searchOpen: boolean
  setSearchOpen: Setter<boolean>
  searchSessionId: string
  setSearchSessionId: Setter<string>
  searchQuery: string
  setSearchQuery: Setter<string>
  activeSearchMessageId: string
  setActiveSearchMessageId: Setter<string>
  activeHistorical: HistoricalConversation | null
  setActiveHistorical: Setter<HistoricalConversation | null>
  forwardedBlock: ForwardBlock | null
  setForwardedBlock: Setter<ForwardBlock | null>
  selectMode: boolean
  setSelectMode: Setter<boolean>
  selectedMessageIds: Set<string>
  setSelectedMessageIds: Setter<Set<string>>
  pendingForward: ForwardBlock | null
  setPendingForward: Setter<ForwardBlock | null>
  searchVisible: boolean
  normalizedSearchQuery: string
  searchResults: CcMessage[]
  shownActiveSearchMessageId: string
  activeSearchIndex: number
  startSelecting: (messageId?: string) => void
  stopSelecting: () => void
  toggleSelectedMessage: (messageId: string) => void
  forwardSelectedMessages: () => void
  confirmForwardTo: (targetSessionId: string) => void
  moveSearch: (direction: -1 | 1) => void
  closeSearch: () => void
  copy: (text: string) => void
  openSearchFromFloat: () => void
}
