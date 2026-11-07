import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }))
vi.mock('../app/lib/dashboardAuth', () => ({ DASHBOARD_SESSION_COOKIE: 'session', getDashboardAuthConfig: () => ({ configured: true, sessionSecret: 'secret' }), verifyDashboardSession: vi.fn() }))
vi.mock('../app/lib/deviceEvents', () => ({ readDeviceBody: async () => ({ event: 'opened', app_id: 'forged', source: 'shortcut' }), forwardDeviceEvents: vi.fn(async () => Response.json({ ok: true })) }))
import { POST } from '../app/api/device-events/self/route'
import { verifyDashboardSession } from '../app/lib/dashboardAuth'
import { forwardDeviceEvents } from '../app/lib/deviceEvents'
beforeEach(() => vi.mocked(verifyDashboardSession).mockReturnValue(false))
afterEach(() => vi.clearAllMocks())
it('requires a real login session even in development', async () => {
  expect((await POST(new Request('https://home.test'))).status).toBe(401)
  expect(forwardDeviceEvents).not.toHaveBeenCalled()
})
it('fixes the app identity server side', async () => {
  vi.mocked(verifyDashboardSession).mockReturnValue(true)
  expect((await POST(new Request('https://home.test'))).status).toBe(200)
  expect(forwardDeviceEvents).toHaveBeenCalledWith(expect.objectContaining({ app_id: 'home', app_name: '我们家', source: 'pwa' }))
})
