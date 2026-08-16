import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertProductionMcpUrl,
  getHavenBaseUrl,
  getHavenGatewayConnection,
  getHavenSessionPassword,
  joinHavenUrl,
  normalizeHavenBaseUrl,
  redactHavenSecrets,
} from '@/app/lib/havenConfig'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Haven production runtime configuration', () => {
  it('uses only the private production base URL and normalizes path joining', () => {
    const env = {
      NODE_ENV: 'production',
      HAVEN_GATEWAY_URL: 'https://haven.example/base/',
      OMBRE_GATEWAY_TOKEN: 'gateway-secret',
      OMBRE_SESSION: 'brain-secret',
      OMBRE_BASE_URL: 'https://legacy.example',
      NEXT_PUBLIC_OMBRE_BASE_URL: 'https://public.example',
      NEXT_PUBLIC_OMBRE_SESSION: 'public-secret',
    }

    expect(getHavenBaseUrl(env)).toBe('https://haven.example/base')
    expect(getHavenGatewayConnection(env)).toEqual({
      baseUrl: 'https://haven.example/base',
      token: 'gateway-secret',
    })
    expect(getHavenSessionPassword(env)).toBe('brain-secret')
    expect(joinHavenUrl(getHavenBaseUrl(env), '/gateway/api/cc/mcp'))
      .toBe('https://haven.example/base/gateway/api/cc/mcp')
    expect(joinHavenUrl(getHavenBaseUrl(env), 'api/buckets?full=1'))
      .toBe('https://haven.example/base/api/buckets?full=1')
  })

  it('fails closed when required production configuration is missing', () => {
    const publicOnly = {
      NODE_ENV: 'production',
      OMBRE_BASE_URL: 'https://legacy.example',
      NEXT_PUBLIC_OMBRE_BASE_URL: 'https://public.example',
      NEXT_PUBLIC_OMBRE_SESSION: 'public-secret',
    }

    expect(() => getHavenBaseUrl(publicOnly)).toThrow('缺少 HAVEN_GATEWAY_URL')
    expect(() => getHavenSessionPassword(publicOnly)).toThrow('缺少 OMBRE_SESSION')
    expect(() => getHavenGatewayConnection({
      ...publicOnly,
      HAVEN_GATEWAY_URL: 'https://haven.example',
    })).toThrow('缺少 OMBRE_GATEWAY_TOKEN')
  })

  it.each([
    'http://localhost:8080',
    'http://service.localhost:8080',
    'http://127.0.0.1:18001',
    'http://127.9.8.7:18001',
    'http://[::1]:8080',
    'http://0.0.0.0:8080',
  ])('rejects production loopback Haven URL %s', (url) => {
    expect(() => normalizeHavenBaseUrl(url, { NODE_ENV: 'production' }))
      .toThrow('不得指向 localhost 或 loopback')
  })

  it.each([
    'not-a-url',
    'ftp://haven.example',
    'https://user:password@haven.example',
    'https://haven.example?token=secret',
    'https://haven.example/#secret',
  ])('rejects an invalid Haven base URL without echoing it: %s', (url) => {
    let message = ''
    try {
      normalizeHavenBaseUrl(url, { NODE_ENV: 'production' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toBe('')
    expect(message).not.toContain(url)
    expect(message).not.toContain('password')
    expect(message).not.toContain('secret')
  })

  it('keeps the existing local development fallback order', () => {
    expect(getHavenBaseUrl({
      NODE_ENV: 'development',
      OMBRE_BASE_URL: 'http://localhost:8080/',
      NEXT_PUBLIC_OMBRE_BASE_URL: 'https://public.example',
    })).toBe('http://localhost:8080')
    expect(getHavenSessionPassword({
      NODE_ENV: 'development',
      NEXT_PUBLIC_OMBRE_SESSION: 'local-password',
    })).toBe('local-password')
  })

  it('rejects loopback MCP only in production', () => {
    expect(() => assertProductionMcpUrl('http://127.0.0.1:18001/mcp', { NODE_ENV: 'production' }))
      .toThrow('production 的 MCP URL')
    expect(() => assertProductionMcpUrl('https://mcp.example/mcp', { NODE_ENV: 'production' }))
      .not.toThrow()
    expect(() => assertProductionMcpUrl('http://127.0.0.1:18001/mcp', { NODE_ENV: 'development' }))
      .not.toThrow()
  })

  it('redacts server-only Haven secrets from errors without exposing their values', () => {
    const message = redactHavenSecrets(
      'gateway=gateway-secret session=brain-secret public=legacy-secret',
      {
        OMBRE_GATEWAY_TOKEN: 'gateway-secret',
        OMBRE_SESSION: 'brain-secret',
        NEXT_PUBLIC_OMBRE_SESSION: 'legacy-secret',
      },
    )
    expect(message).toBe('gateway=[REDACTED] session=[REDACTED] public=[REDACTED]')
  })
})
