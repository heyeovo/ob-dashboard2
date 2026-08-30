import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ccSession = vi.hoisted(() => ({ getExactContextAnalysis: vi.fn() }))
vi.mock('@/app/lib/ccSession', () => ccSession)

import { POST } from '@/app/api/cc-context-analysis/route'

beforeEach(() => vi.clearAllMocks())

describe('/api/cc-context-analysis', () => {
  it('binds a manual SDK read to the selected native lane', async () => {
    ccSession.getExactContextAnalysis.mockResolvedValue({ ok: true, analysis: { totalTokens: 123 }, cached: false, error: '' })
    const response = await POST(new NextRequest('http://localhost/api/cc-context-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', cred: 'api', provider_id: 'kiro', force: true }),
    }))
    expect(response.status).toBe(200)
    expect(ccSession.getExactContextAnalysis).toHaveBeenCalledWith({
      sessionId: 's1',
      laneId: 'api:kiro',
      force: true,
    })
  })

  it('returns a conflict without starting a new session when the live lane is unavailable', async () => {
    ccSession.getExactContextAnalysis.mockResolvedValue({
      ok: false,
      analysis: null,
      cached: false,
      error: '当前 CC 会话不在线，请先在这个窗口发一条消息',
    })
    const response = await POST(new NextRequest('http://localhost/api/cc-context-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', cred: 'subscription' }),
    }))
    const payload = await response.json()
    expect(response.status).toBe(409)
    expect(payload.error).toContain('不在线')
    expect(ccSession.getExactContextAnalysis).toHaveBeenCalledWith({
      sessionId: 's1',
      laneId: 'subscription',
      force: false,
    })
  })
})
