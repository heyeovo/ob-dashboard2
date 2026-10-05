import { getBuckets, getSessionCookie } from '../api'
import { getHavenBaseUrl, joinHavenUrl } from '../havenConfig'
import { listSessions, listTurns, type HavenTurn } from '../havenTurns'
import { selectRollingPinnedSnapshot } from '../cc/windowPrompt'
import { estimateHandoffTokens } from '../cc/handoffSnapshot'
import type { TrpgSettings } from './server'

export type SeatContext = { pinned: string[]; reviews: string[]; chat: string[] }

/** Bodies are already normalized by Haven; never read raw_json or attachments. */
export function seatChatRound(turn: Pick<HavenTurn, 'created_at' | 'user_text' | 'assistant_text'>): string {
  const date = new Date(turn.created_at)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const part = (type: string) => parts.find(p => p.type === type)?.value || ''
  const stamp = `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
  return [['小羊', turn.user_text], ['言之', turn.assistant_text]].flatMap(([name, body]) => {
    const text = body.trim()
    return text ? [`[${stamp}] ${name}：${text.length > 800 ? text.slice(0, 800) + '…' : text}`] : []
  }).join('\n')
}

export function buildSeatContext(source: SeatContext, budget = 30000): string {
  const pinned = [...source.pinned], reviews = [...source.reviews], chat = [...source.chat]
  const render = () => {
    if (!pinned.length && !reviews.length && !chat.length) return ''
    return ['<trpg_real_life_context>', '下面是现实里的背景（我们最近的生活），不是跑团内容，也不是守秘人给的信息', ...pinned, ...reviews, ...(chat.length ? ['【主窗最近对话】', ...chat] : []), '</trpg_real_life_context>'].join('\n\n')
  }
  while (estimateHandoffTokens(render()) > budget && chat.length) chat.shift()
  while (estimateHandoffTokens(render()) > budget && reviews.length) reviews.shift()
  // Pinned full text is intentionally never cut, even if it alone exceeds budget.
  return render()
}

export async function loadSeatContext(settings: TrpgSettings, personaId: string, now = new Date()): Promise<string> {
  const reviewDays = settings.context_review_days ?? 5
  const rounds = settings.context_main_rounds ?? 10
  const results = await Promise.allSettled([
    (async () => settings.context_pinned === false ? [] : selectRollingPinnedSnapshot(await getBuckets(true), null).map(b => `【钉选记忆｜${b.title}】\n${b.content}`))(),
    (async () => {
      if (!reviewDays) return []
      // Include today, matching the handoff picker which does not exclude today's review.
      const end = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
      const start = new Date(Date.parse(end) - (reviewDays - 1) * 86400000).toISOString().slice(0, 10)
      const params = new URLSearchParams({ persona_id: personaId, start_date: start, end_date: end, limit: '7' })
      const cookie = await getSessionCookie()
      const response = await fetch(joinHavenUrl(getHavenBaseUrl(), `/api/daily-reviews?${params}`), { headers: { Cookie: cookie }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!response.ok) return []
      const payload = await response.json() as { items?: { review_date: string; content: string }[] }
      return (payload.items || []).filter(r => r.review_date >= start && r.review_date <= end && r.content.trim()).sort((a, b) => a.review_date.localeCompare(b.review_date)).map(r => `【日回顾｜${r.review_date}】\n${r.content}`)
    })(),
    (async () => {
      if (!rounds) return []
      let offset = 0
      for (;;) {
        const result = await listSessions({ personaId, limit: 100, offset })
        if (!result.ok) return []
        const main = result.sessions.find(s => s.persona_id === personaId && s.pinned_at && !s.deleted_at)
        if (main) {
          const result = await listTurns(main.session_id, { limit: rounds })
          return result.ok ? [...result.turns].sort((a, b) => a.id - b.id).slice(-rounds).map(seatChatRound).filter(Boolean) : []
        }
        offset += result.sessions.length
        if (!result.sessions.length || offset >= result.total) return []
      }
    })(),
  ])
  const value = (index: number): string[] => results[index].status === 'fulfilled' ? results[index].value : []
  return buildSeatContext({ pinned: value(0), reviews: value(1), chat: value(2) })
}
