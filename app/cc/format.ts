import type { CcMessage } from './types'

export function formatCost(usd: number) {
  if (!usd) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function visibleChatDay(message: CcMessage): string {
  if (message.chatDay) return message.chatDay
  return new Date(message.createdAt - 4 * 60 * 60 * 1000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  })
}

export function formatCacheLeft(ms: number) {
  if (ms <= 0) return null
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60 ? `${sec % 60}s` : ''}`
}

/** 「23.4k / 1M」。上下文用量胶囊用。 */
export function formatTokens(n: number) {
  if (n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}
