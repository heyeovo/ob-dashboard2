import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), receipt: vi.fn() }))
vi.mock('@/app/lib/havenTurns', () => ({ getConversationSession: mocks.session, getRollingSeedReceipt: mocks.receipt }))
vi.mock('@/app/lib/cc/ccOptions', () => ({ ccLaneId: () => 'api:provider' }))
import { GET } from '@/app/api/cc-rolling-state/route'
describe('exact rolling state endpoint', () => {
  beforeEach(() => {
    mocks.session.mockResolvedValue({ ok: true, session: { context_revision: 9, cc_lanes: { 'api:provider': { cc_session_id: 'native-9' } } } })
    mocks.receipt.mockResolvedValue({ contextRevision: 9, newSessionId: 'native-9', days: [{ day: '2026-01-01', treatment: 'full' }] })
  })
  const read = () => GET(new NextRequest('https://example.test/api/cc-rolling-state?session_id=window'))
  it('reads exact receipt without loading recent turns or full audit', async () => {
    expect(await (await read()).json()).toEqual({ ok: true, revision: 9, days: [{ day: '2026-01-01', treatment: 'full' }] })
    expect(mocks.receipt).toHaveBeenCalledWith('window', 'native-9')
  })
  it('returns no status when receipt is absent or raced with a revision save', async () => {
    mocks.receipt.mockResolvedValue(null)
    expect((await (await read()).json()).days).toBeNull()
    mocks.receipt.mockResolvedValue({ contextRevision: 10, days: [] })
    expect((await (await read()).json()).days).toBeNull()
  })
})
