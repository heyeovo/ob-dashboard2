import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('../app/lib/havenConfig', () => ({
  getHavenGatewayConnection: () => ({ baseUrl: 'https://haven.test', token: 'gateway' }),
  joinHavenUrl: (base: string, path: string) => base + path,
}))
import { POST } from '../app/api/device-events/route'
import { deviceDigest } from '../app/lib/deviceDigest'
const request = (body = '{}', token = 'phone') => new Request('https://home.test/api/device-events', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
})
beforeEach(() => { vi.stubEnv('DEVICE_EVENTS_TOKEN', 'phone'); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('phone write endpoint', () => {
  it('fails closed without configuration', async () => {
    vi.stubEnv('DEVICE_EVENTS_TOKEN', '')
    expect((await POST(request())).status).toBe(503)
  })
  it('rejects wrong or absent bearer', async () => {
    expect((await POST(request('{}', 'wrong'))).status).toBe(401)
    expect((await POST(new Request('https://home.test', { method: 'POST' }))).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('forwards with gateway credential', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ accepted: 1, duplicates: 0 }))
    expect(await (await POST(request())).json()).toEqual({ ok: true, accepted: 1, duplicates: 0 })
    expect(fetch).toHaveBeenCalledWith('https://haven.test/api/device-events', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer gateway' }) }))
  })
  it('bounds streamed body bytes', async () => {
    expect((await POST(request('中'.repeat(5500)))).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
})
describe('wake digest', () => {
  it('silences failed, invalid and empty responses', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(Response.json({ digest: '' })).mockResolvedValueOnce(new Response('invalid'))
    for (let i = 0; i < 4; i++) expect(await deviceDigest()).toBe('')
  })
  it('uses a two second deadline and returns the digest', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.mocked(fetch).mockResolvedValue(Response.json({ digest: '[手机 记录]' }))
    expect(await deviceDigest()).toBe('[手机 记录]')
    expect(timeout).toHaveBeenCalledWith(2000)
  })
})
