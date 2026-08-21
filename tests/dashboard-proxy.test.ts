import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'

import { createDashboardSession, DASHBOARD_SESSION_COOKIE } from '@/app/lib/dashboardAuth'
import { config, proxy } from '../proxy'

const LOGIN_SECRET = 'proxy-test-login-passphrase'
const SESSION_SECRET = 'proxy-test-session-signing-secret-at-least-32-bytes'
const ORIGINAL_ENV = { ...process.env }

function request(path: string, token = '') {
  return new NextRequest(`https://dashboard.example${path}`, {
    headers: token ? { cookie: `${DASHBOARD_SESSION_COOKIE}=${token}` } : undefined,
  })
}

beforeEach(() => {
  process.env.NODE_ENV = 'production'
  process.env.DASHBOARD_LOGIN_SECRET = LOGIN_SECRET
  process.env.DASHBOARD_SESSION_SECRET = SESSION_SECRET
  delete process.env.OB2_LAN_SECRET
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('Dashboard proxy protection', () => {
  it('redirects anonymous pages and rejects anonymous private APIs', () => {
    const page = proxy(request('/cc?view=chat'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toContain('/login?next=%2Fcc%3Fview%3Dchat')
    expect(page.headers.get('cache-control')).toBe('no-store')

    const api = proxy(request('/api/cc-permission'))
    expect(api.status).toBe(401)
    expect(api.headers.get('cache-control')).toBe('no-store')
  })

  it('accepts a valid session and rejects forged, expired, and retired plaintext cookies', () => {
    const valid = createDashboardSession(SESSION_SECRET)
    expect(proxy(request('/api/cc-chat', valid.token)).status).toBe(200)
    expect(proxy(request('/api/cc-chat', `${valid.token.slice(0, -1)}x`)).status).toBe(401)

    const expired = createDashboardSession(SESSION_SECRET, Date.now() - 8 * 24 * 60 * 60 * 1000)
    expect(proxy(request('/api/haven/private', expired.token)).status).toBe(401)
    const legacy = new NextRequest('https://dashboard.example/api/gateway/private', {
      headers: { cookie: `ob2_lan=${LOGIN_SECRET}` },
    })
    expect(proxy(legacy).status).toBe(401)
  })

  it('does not accept or preserve the retired k query login', () => {
    const response = proxy(request(`/?k=${encodeURIComponent(LOGIN_SECRET)}`))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://dashboard.example/login')
  })

  it('fails closed for both pages and APIs when production configuration is incomplete', () => {
    delete process.env.DASHBOARD_LOGIN_SECRET
    delete process.env.DASHBOARD_SESSION_SECRET
    expect(proxy(request('/')).status).toBe(503)
    expect(proxy(request('/api/cc-chat')).status).toBe(503)
  })

  it('keeps only the exact login, health, bearer runner, PWA assets, and Next build assets public', () => {
    for (const path of [
      '/login',
      '/api/auth/login',
      '/api/health',
      '/api/automation-pro-runner',
      '/manifest.json',
      '/sw.js',
      '/favicon.ico',
      '/ob-icon-192.png',
      '/ob-icon-512.png',
    ]) {
      expect(proxy(request(path)).status, path).toBe(200)
    }
    for (const path of [
      '/private.png',
      '/chat-app/index.html',
      '/api/auth/logout',
      '/api/mcp-relay/private',
      '/api/provider-relay',
      '/api/automation-pro-runner/private',
    ]) {
      expect(proxy(request(path)).status, path).not.toBe(200)
    }
    expect(unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: '/_next/static/chunks/app.js',
    })).toBe(false)
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: '/_next/staticity/private' })).toBe(true)
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: '/private.webp' })).toBe(true)
  })
})
