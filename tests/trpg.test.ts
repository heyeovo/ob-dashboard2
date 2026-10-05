import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST, PATCH, DELETE } from '@/app/api/trpg/[...path]/route'
import { kickTrpgTurn } from '@/app/lib/trpg/scheduler'
import { mergeLogs, type Log } from '@/app/lib/trpg/table'

vi.mock('@/app/lib/havenConfig', () => ({
  getHavenBaseUrl: () => 'http://haven.test', getHavenGatewayToken: () => 'test-gateway',
  joinHavenUrl: (base: string, path: string) => base + path,
}))
vi.mock('@/app/lib/trpg/scheduler', () => ({ kickTrpgTurn: vi.fn() }))
const fetchMock = vi.fn()
function request(path: string, method = 'GET') {
  return new Request(`http://dashboard.test/api/trpg/${path}?since_seq=12&viewer=dm`, {
    method, headers: { Cookie: 'private-browser-cookie', Authorization: 'browser-secret' },
    ...(method === 'POST' ? { body: '{"text":"行动"}' } : {}),
  })
}
function context(path: string) { return { params: Promise.resolve({ path: path.split('/') }) } }

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValue(Response.json({ ok: true })) })
afterEach(() => vi.unstubAllGlobals())

describe('TRPG proxy', () => {
  it.each(['games/g/yanzhi-view', 'games/g/yanzhi-table-talk', 'games/g/phase', 'games/g', 'modules/m/scenes', 'dm/mcp', 'games/g/table/extra', 'modules/../pregens', 'modules/m%2Fsecret/pregens'])('rejects %s without fetching', async path => {
    expect((await GET(request(path), context(path))).status).toBe(404)
    expect((await POST(request(path, 'POST'), context(path))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['modules', 'modules/m/pregens', 'games', 'games/g/table'])('allows GET %s and sends only service authorization', async path => {
    const response = await GET(request(path), context(path))
    expect(response.status).toBe(200)
    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`http://haven.test/trpg/api/${path}${path.endsWith('table') ? '?since_seq=12' : ''}`)
    expect(options.headers).toEqual({ Authorization: 'Bearer test-gateway', 'Content-Type': 'application/json' })
    expect(options.cache).toBe('no-store')
    expect(options.redirect).toBe('error')
    expect(kickTrpgTurn).not.toHaveBeenCalled()
  })
  it.each(['modules', 'games'])('allows creation POST %s without scheduling', async path => {
    expect((await POST(request(path, 'POST'), context(path))).status).toBe(200)
    expect(fetchMock.mock.calls[0][1].body).toBe('{"text":"行动"}')
    expect(kickTrpgTurn).not.toHaveBeenCalled()
  })
  it.each(['action', 'table-talk', 'settle', 'checks/c/roll'])('kicks a successful %s exactly once', async suffix => {
    const path = `games/g/${suffix}`
    expect((await POST(request(path, 'POST'), context(path))).status).toBe(200)
    expect(kickTrpgTurn).toHaveBeenCalledExactlyOnceWith('g', suffix.split('/').at(-1))
  })
  it.each([400, 409])('preserves Haven %s and never schedules failed writes', async status => {
    for (const suffix of ['action', 'table-talk', 'settle', 'checks/c/roll']) {
      fetchMock.mockResolvedValueOnce(Response.json({ error: 'phase conflict' }, { status }))
      const path = `games/g/${suffix}`
      const response = await POST(request(path, 'POST'), context(path))
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: 'phase conflict' })
    }
    expect(kickTrpgTurn).not.toHaveBeenCalled()
  })
  it('rejects wrong methods for allowed paths', async () => {
    expect((await POST(request('games/g/table', 'POST'), context('games/g/table'))).status).toBe(404)
    expect((await GET(request('games/g/action'), context('games/g/action'))).status).toBe(404)
  })
  it('returns a generic failure without exposing upstream errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('secret-gateway-token'))
    const response = await GET(request('games'), context('games'))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('secret-gateway-token')
  })
})

it('merges visible log increments by seq, deduplicates and sorts without mutation', () => {
  const log = (seq: number, text = String(seq)): Log => ({ seq, text, kind: 'narration', author: 'dm', created_at: '' })
  const existing = [log(4), log(1)]
  expect(mergeLogs(existing, [log(3), log(4, 'updated'), log(8)])).toEqual([log(1), log(3), log(4, 'updated'), log(8)])
  expect(existing).toEqual([log(4), log(1)])
  expect(mergeLogs(existing, [])).toEqual([log(1), log(4)])
})


it('allows settings PATCH and runtime GET but never runtime writes', async () => {
  fetchMock.mockImplementation(async () => Response.json({ ok: true }))
  expect((await GET(request('games/g/yanzhi-runtime'), context('games/g/yanzhi-runtime'))).status).toBe(200)
  expect((await POST(request('games/g/yanzhi-runtime', 'POST'), context('games/g/yanzhi-runtime'))).status).toBe(404)
  expect((await PATCH(request('games/g/yanzhi-runtime', 'PATCH'), context('games/g/yanzhi-runtime'))).status).toBe(404)
  expect((await PATCH(new Request('http://dashboard.test', { method: 'PATCH', body: '{"yanzhi_model":"claude-sonnet-5"}' }), context('games/g/settings'))).status).toBe(200)
  expect(fetchMock.mock.calls.at(-1)?.[1].body).toBe('{"yanzhi_model":"claude-sonnet-5"}')
  expect(kickTrpgTurn).not.toHaveBeenCalled()
})

it('returns immediately while the scheduler is running', async () => {
  vi.mocked(kickTrpgTurn).mockReturnValueOnce(new Promise(() => {}))
  expect((await POST(request('games/g/action', 'POST'), context('games/g/action'))).status).toBe(200)
})

it('forwards end and module delete without scheduling and rejects game deletion', async () => {
  fetchMock.mockImplementation(async () => Response.json({ ok: true }))
  expect((await POST(request('games/g/end', 'POST'), context('games/g/end'))).status).toBe(200)
  expect((await DELETE(request('modules/m', 'DELETE'), context('modules/m'))).status).toBe(200)
  expect((await DELETE(request('games/g', 'DELETE'), context('games/g'))).status).toBe(404)
  expect(kickTrpgTurn).not.toHaveBeenCalled()
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'active game uses module' }, { status: 409 }))
  expect((await DELETE(request('modules/m', 'DELETE'), context('modules/m'))).status).toBe(409)
})
