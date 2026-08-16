import { describe, expect, it } from 'vitest'
import { vercelHostname } from '@/app/cc/useIsRemote'

describe('cc runtime surface detection', () => {
  it('keeps Vercel on selfhost while allowing Coolify and local cc runtimes', () => {
    expect(vercelHostname('ob-dashboard2.vercel.app')).toBe(true)
    expect(vercelHostname('ob-dashboard2-git-preview.vercel.app')).toBe(true)
    expect(vercelHostname('dashboard-vps.23.95.136.46.sslip.io')).toBe(false)
    expect(vercelHostname('dashboard.example.com')).toBe(false)
    expect(vercelHostname('localhost')).toBe(false)
    expect(vercelHostname('192.168.1.20')).toBe(false)
  })
})
