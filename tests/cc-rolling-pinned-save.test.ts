import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const deps = vi.hoisted(() => ({ getBuckets: vi.fn(), patch: vi.fn() }))
vi.mock('@/app/lib/api', () => ({ getBuckets: deps.getBuckets, getJournals: vi.fn() }))
vi.mock('@/app/lib/havenTurns', async importOriginal => ({
  ...await importOriginal<typeof import('@/app/lib/havenTurns')>(),
  patchConversationRollingContext: deps.patch,
}))
import { PATCH } from '@/app/api/cc-turns/route'

function request(strategy = 'daily_rolling') {
  return new NextRequest('http://localhost/api/cc-turns', {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: 'window-1', persona_id: 'ombre', expected_state_version: 4,
      rolling_context: { strategy, selected_pinned_ids: ['pin-1'], pinned_snapshot: [{ id: 'fake', title: 'fake', content: 'fake' }] },
    }),
  })
}

describe('explicit rolling context save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deps.patch.mockResolvedValue({ ok: true, session: {}, error: '' })
    deps.getBuckets.mockResolvedValue([
      { id: 'pin-1', name: '标题', content: '最新正文', pinned: true },
      { id: 'pin-2', content: '未选正文', pinned: true },
    ])
  })

  it('captures current selected pinned text server-side and preserves the CAS version', async () => {
    expect((await PATCH(request())).status).toBe(200)
    expect(deps.patch).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'window-1', personaId: 'ombre', expectedStateVersion: 4,
      rollingContext: expect.objectContaining({ pinned_snapshot: [{ id: 'pin-1', title: '标题', content: '最新正文' }] }),
    }))
  })

  it('saves an empty snapshot when all selected buckets were unpinned', async () => {
    deps.getBuckets.mockResolvedValue([{ id: 'pin-1', content: '正文', pinned: false }])
    await PATCH(request())
    expect(deps.patch.mock.calls[0][0].rollingContext.pinned_snapshot).toEqual([])
  })

  it('does not save partial context on a bucket read failure', async () => {
    deps.getBuckets.mockRejectedValue(new Error('offline'))
    expect((await PATCH(request())).status).toBe(502)
    expect(deps.patch).not.toHaveBeenCalled()
  })

  it('leaves fixed-window behavior intact and propagates state conflicts', async () => {
    await PATCH(request('fixed_window'))
    expect(deps.getBuckets).not.toHaveBeenCalled()
    expect(deps.patch.mock.calls[0][0].rollingContext.pinned_snapshot).toBeUndefined()
    deps.patch.mockResolvedValue({ ok: false, session: null, error: 'session_state_conflict', httpStatus: 409 })
    expect((await PATCH(request())).status).toBe(409)
  })
})
