import { beforeEach, expect, it, vi } from 'vitest'
import { buildSeatContext, loadSeatContext, seatChatRound } from '@/app/lib/trpg/seatContext'
import { getBuckets, getSessionCookie } from '@/app/lib/api'
import { listSessions, listTurns, type HavenTurn } from '@/app/lib/havenTurns'
import { estimateHandoffTokens } from '@/app/lib/cc/handoffSnapshot'
vi.mock('@/app/lib/api', () => ({ getBuckets: vi.fn(), getSessionCookie: vi.fn(async () => 'fake') }))
vi.mock('@/app/lib/havenConfig', () => ({ getHavenBaseUrl: () => 'http://fake', joinHavenUrl: (base: string, path: string) => base + path }))
vi.mock('@/app/lib/havenTurns', () => ({ listSessions: vi.fn(), listTurns: vi.fn() }))
const settings = { yanzhi_model: 'claude-opus-4-6', persona_id: 'p' }
const now = new Date('2026-10-05T17:00:00Z')
const turn = { id: 1, created_at: '2026-10-05T17:00:00Z', user_text: '你好', assistant_text: '回来了', raw_json: 'THINKING TOOL RECALL', attachments: [{ text: 'ATTACHMENT' }] } as unknown as HavenTurn
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBuckets).mockResolvedValue([{ id: 'b', pinned: true, content: 'PINNED', name: '家' }])
  vi.mocked(listSessions).mockResolvedValue({ ok: true, total: 1, error: '', sessions: [{ session_id: 'main', persona_id: 'p', pinned_at: 'now' }] } as Awaited<ReturnType<typeof listSessions>>)
  vi.mocked(listTurns).mockResolvedValue({ ok: true, turns: [turn], error: '' })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ review_date: '2026-10-06', content: 'TODAY' }, { review_date: '2026-10-02', content: 'OLDEST' }, { review_date: '2026-10-01', content: 'OUTSIDE' }] }) })))
})
it('loads default sources, scopes main window, includes Beijing today and only calendar range', async () => {
  const text = await loadSeatContext(settings, 'p', now)
  for (const word of ['PINNED', 'TODAY', 'OLDEST', '[10-06 01:00] 小羊：你好', '言之：回来了']) expect(text).toContain(word)
  for (const word of ['OUTSIDE', 'THINKING', 'TOOL', 'RECALL', 'ATTACHMENT']) expect(text).not.toContain(word)
  expect(listSessions).toHaveBeenCalledWith({ personaId: 'p', limit: 100, offset: 0 })
  expect(listTurns).toHaveBeenCalledWith('main', { limit: 10 })
})
it('does not read disabled sources', async () => {
  expect(await loadSeatContext({ ...settings, context_pinned: false, context_review_days: 0, context_main_rounds: 0 }, 'p', now)).toBe('')
  expect(getBuckets).not.toHaveBeenCalled(); expect(getSessionCookie).not.toHaveBeenCalled(); expect(listSessions).not.toHaveBeenCalled()
})
it('skips a missing main window', async () => {
  vi.mocked(listSessions).mockResolvedValue({ ok: true, sessions: [], total: 0, error: '' })
  expect(await loadSeatContext(settings, 'p', now)).not.toContain('主窗最近对话')
})
it('skips failed sources independently', async () => {
  vi.mocked(getBuckets).mockRejectedValue(new Error('failed'))
  vi.mocked(listTurns).mockResolvedValue({ ok: false, turns: [], error: 'failed' })
  const text = await loadSeatContext(settings, 'p', now)
  expect(text).toContain('TODAY'); expect(text).not.toContain('钉选记忆'); expect(text).not.toContain('主窗最近对话')
  vi.mocked(listSessions).mockRejectedValue(new Error('failed'))
  vi.mocked(fetch).mockRejectedValue(new Error('failed'))
  expect(await loadSeatContext(settings, 'p', now)).toBe('')
})
it('caps each body at 800 characters', () => {
  const text = seatChatRound({ ...turn, user_text: '羊'.repeat(801) })
  expect(text).toContain('羊'.repeat(800) + '…'); expect(text).not.toContain('羊'.repeat(801))
})
it('drops oldest chats before oldest reviews and never cuts pinned', () => {
  const source = { pinned: ['PIN'], reviews: ['OLD_REVIEW', 'NEW_REVIEW'], chat: ['OLD_CHAT', 'NEW_CHAT'] }
  const budget = estimateHandoffTokens(buildSeatContext({ ...source, chat: ['NEW_CHAT'] }))
  const result = buildSeatContext(source, budget)
  expect(result).not.toContain('OLD_CHAT'); expect(result).toContain('NEW_CHAT'); expect(result).toContain('OLD_REVIEW')
  const reviewBudget = estimateHandoffTokens(buildSeatContext({ ...source, reviews: ['NEW_REVIEW'], chat: [] }))
  const trimmed = buildSeatContext(source, reviewBudget)
  expect(trimmed).not.toContain('CHAT'); expect(trimmed).not.toContain('OLD_REVIEW'); expect(trimmed).toContain('NEW_REVIEW')
  expect(buildSeatContext(source, 1)).toContain('PIN')
})
