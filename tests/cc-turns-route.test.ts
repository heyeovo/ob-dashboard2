import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const haven = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listTurns: vi.fn(),
  getConversationSession: vi.fn(),
  renameConversationSession: vi.fn(),
  patchConversationSessionState: vi.fn(),
  softDeleteConversationSession: vi.fn(),
  permanentlyDeleteConversationSession: vi.fn(),
}))

vi.mock('@/app/lib/havenTurns', () => haven)

import { DELETE, GET, PATCH } from '@/app/api/cc-turns/route'

beforeEach(() => {
  vi.clearAllMocks()
  haven.listSessions.mockResolvedValue({ ok: true, sessions: [], error: '' })
  haven.listTurns.mockResolvedValue({ ok: true, turns: [], error: '' })
  haven.getConversationSession.mockResolvedValue({ ok: true, found: false, session: null, error: '' })
  haven.patchConversationSessionState.mockResolvedValue({ ok: true, session: { local_engine_preference: 'selfhost' }, error: '', httpStatus: 200 })
  haven.renameConversationSession.mockResolvedValue({ ok: true, title: '新标题', error: '' })
  haven.permanentlyDeleteConversationSession.mockResolvedValue({ ok: true, deletedCounts: { conversation_turns: 2 }, error: '' })
})

describe('/api/cc-turns 10.3 session state and deletion integration', () => {
  it('requests the persisted deleted-session list explicitly', async () => {
    const response = await GET(new NextRequest('http://localhost/api/cc-turns?deleted=1&persona_id=ombre'))
    expect(response.status).toBe(200)
    expect(haven.listSessions).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }))
  })

  it('filters imported and chat sessions by the same persona owner', async () => {
    haven.listSessions.mockResolvedValue({
      ok: true,
      sessions: [
        { session_id: 'chat-yanzhi', source: 'cc', persona_id: 'ombre', client: 'ob2-chat/ombre' },
        { session_id: 'polaris-yanzhi', source: 'polaris', persona_id: 'ombre', client: 'polaris' },
        { session_id: 'gateway-yanzhi', source: 'gateway', persona_id: '', client: '' },
        { session_id: 'chat-ombre3', source: 'selfhost', persona_id: 'ombre3', client: 'ob2-selfhost/ombre3' },
      ],
      error: '',
    })

    const response = await GET(new NextRequest('http://localhost/api/cc-turns?persona_id=ombre3'))
    const payload = await response.json()

    expect(payload.sessions.map((session: { session_id: string }) => session.session_id)).toEqual([
      'chat-ombre3',
    ])
  })

  it('loads session state together with turns', async () => {
    haven.getConversationSession.mockResolvedValue({
      ok: true,
      found: true,
      session: { local_engine_preference: 'selfhost' },
      error: '',
    })
    const response = await GET(new NextRequest('http://localhost/api/cc-turns?session_id=s1&raw=1'))
    const payload = await response.json()
    expect(payload.session.local_engine_preference).toBe('selfhost')
  })

  it('persists local_engine_preference without accepting effective_engine', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/cc-turns', {
      method: 'PATCH',
      body: JSON.stringify({ session_id: 's1', persona_id: 'ombre', local_engine_preference: 'selfhost' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(response.status).toBe(200)
    expect(haven.patchConversationSessionState).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1', personaId: 'ombre', localEnginePreference: 'selfhost',
    }))
  })

  it('binds persona and local preference before renaming a new window', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/cc-turns', {
      method: 'PATCH',
      body: JSON.stringify({
        session_id: 's1', persona_id: 'lyra', local_engine_preference: 'cc', title: '新标题',
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(response.status).toBe(200)
    expect(haven.patchConversationSessionState).toHaveBeenCalledWith(expect.objectContaining({ personaId: 'lyra' }))
    expect(haven.renameConversationSession).toHaveBeenCalledWith('s1', '新标题')
  })

  it('forwards the exact permanent-delete confirmation and reports zero memory buckets', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/cc-turns', {
      method: 'DELETE',
      body: JSON.stringify({ session_id: 's1', permanent: true, confirm_session_id: 's1' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    const payload = await response.json()
    expect(haven.permanentlyDeleteConversationSession).toHaveBeenCalledWith('s1', 's1')
    expect(payload.memory_buckets_deleted).toBe(0)
  })
})
