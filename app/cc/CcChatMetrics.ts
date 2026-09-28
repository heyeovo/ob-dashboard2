import { formatCacheLeft } from './format'
import { modelLabel, modelsFor } from './upstream'
import type { useCcChat } from './useCcChat'
import type { usePersonas } from './usePersonas'

type Chat = ReturnType<typeof useCcChat>
type People = ReturnType<typeof usePersonas>

export function getCcChatMetrics(chat: Chat, people: People, cacheClock: number) {
  // 顶部显示实际在跑的那个模型（stats.model 来自服务端）；进程没起来就显示这一窗选的
  const modelCandidates = modelsFor(chat.upstream, chat.pick.kind, chat.pick.providerId)
  const shownModel = modelLabel(
    chat.latestTurn?.model || chat.stats.model || chat.pick.model,
    modelCandidates,
  )
  const shownProvider = chat.latestTurn?.providerLabel
    || chat.stats.boot?.providerLabel
    || (chat.effectiveEngine === 'cc' && chat.pick.kind === 'subscription' ? 'Claude 订阅' : '')
  const currentLaneId = chat.pick.kind === 'subscription'
    ? 'subscription'
    : `api:${chat.pick.providerId || 'default'}`
  const latestLaneTurn = [...chat.messages].reverse().find(message =>
    message.role === 'assistant' && message.engine !== 'selfhost' && message.laneId === currentLaneId,
  )
  const contextSnapshot = chat.stats.contextSnapshot || latestLaneTurn?.contextSnapshot || null
  const ctxTokens = contextSnapshot?.totalTokens
    || latestLaneTurn?.context?.inputTokensEstimated
    || chat.stats.contextTokens
  const ctxMax = contextSnapshot?.maxTokens
    || latestLaneTurn?.context?.modelContextLimit
    || chat.stats.contextMaxTokens
  const cacheSnapshot = chat.stats.live
    ? chat.stats.cacheRefreshedAt
      ? {
          refreshedAt: chat.stats.cacheRefreshedAt,
          systemTtlMs: 60 * 60 * 1000,
          sessionTtlMs: 5 * 60 * 1000,
        }
      : null
    : latestLaneTurn?.cacheSnapshot || null
  const cacheAge = cacheSnapshot ? Math.max(0, cacheClock - cacheSnapshot.refreshedAt) : 0
  const cacheSystemRemainingMs = cacheSnapshot
    ? Math.max(0, cacheSnapshot.systemTtlMs - cacheAge)
    : 0
  const cacheSessionRemainingMs = cacheSnapshot
    ? Math.max(0, cacheSnapshot.sessionTtlMs - cacheAge)
    : 0
  const cacheSystem = formatCacheLeft(cacheSystemRemainingMs)
  const cacheSession = formatCacheLeft(cacheSessionRemainingMs)
  const cacheLabel = !cacheSnapshot
    ? '缓存待确认'
    : cacheSystem
      ? `缓存 ${cacheSystem}${cacheSession ? ` / 会话 ${cacheSession}` : ' / 会话已过期'}`
      : '缓存已过期'
  const laneCompactions = chat.messages.flatMap(message => {
    if (message.laneId !== currentLaneId) return []
    const standalone = message.compaction ? [message.compaction] : []
    const inline = (message.process || []).flatMap(event => event.type === 'compact' ? [event.compaction] : [])
    return [...standalone, ...inline]
  })
  const allCompactions = [
    ...laneCompactions,
    ...(chat.stats.lastCompaction ? [chat.stats.lastCompaction] : []),
  ]
  const latestCompaction = allCompactions.sort((a, b) => a.at - b.at).at(-1) || null
  const compactionCount = new Set(allCompactions.map(item => item.id)).size
  const displayStats = {
    ...chat.stats,
    contextSnapshot,
    contextTokens: ctxTokens,
    contextMaxTokens: ctxMax,
    cacheRefreshedAt: cacheSnapshot?.refreshedAt || 0,
    cacheRemainingMs: cacheSessionRemainingMs,
    cacheSystemRemainingMs,
    lastCompaction: latestCompaction,
    compactionCount: Math.max(chat.stats.compactionCount, compactionCount),
  }
  const totalChars = chat.messages.reduce((n, m) => n + m.text.length, 0)
  const conversationText = chat.messages.map(message => message.text).join('\n\n')
  const enabledPromptModules = people.active.promptModules.filter(module =>
    chat.promptModuleOverrides[module.id] ?? module.enabledByDefault,
  )
  const systemPromptText = [
    people.active.basePrompt.trim(),
    people.active.purpose.trim() ? `关于我：\n${people.active.purpose.trim()}` : '',
    enabledPromptModules.length
      ? enabledPromptModules.map(module => `【${module.name}】\n${module.content.trim()}`).join('\n\n')
      : '',
    people.active.memoryEntries.length
      ? `以下是关于对方的固定事实，始终成立：\n${people.active.memoryEntries.map(item => `- ${item.trim()}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')

  return { shownModel, shownProvider, contextSnapshot, ctxTokens, ctxMax, cacheLabel,
    displayStats, totalChars, conversationText, systemPromptText }
}
