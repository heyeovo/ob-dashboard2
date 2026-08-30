import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fallbackMcpConfig,
  loadMcpConfig,
  toSdkMcpServers,
  validateMcpConfig,
} from '@/app/lib/ccMcp'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function remoteConfig(url: string) {
  return {
    version: 1,
    servers: [{
      name: 'ombre_brain',
      label: 'Ombre Brain',
      enabled: true,
      transport: 'http',
      url,
      permission: 'allow',
      saveResults: true,
    }],
  }
}

describe('MCP production address boundary', () => {
  it('keeps the local loopback fallback in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fallback = fallbackMcpConfig()
    expect(fallback.servers).toHaveLength(1)
    expect(fallback.servers[0].url).toBe('http://127.0.0.1:18001/mcp')
  })

  it('uses an empty, disabled fallback in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(fallbackMcpConfig()).toEqual({ version: 1, servers: [] })
  })

  it('accepts a production HTTPS MCP URL and preserves the SDK path', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const config = validateMcpConfig(remoteConfig('https://mcp.example/custom/mcp'))
    expect(toSdkMcpServers(config)).toEqual({
      ombre_brain: expect.objectContaining({
        type: 'http',
        url: 'https://mcp.example/custom/mcp',
      }),
    })
  })

  it('preserves discovered input schemas for context estimates', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const config = validateMcpConfig({
      ...remoteConfig('https://mcp.example/mcp'),
      servers: [{
        ...remoteConfig('https://mcp.example/mcp').servers[0],
        tools: [{
          name: 'mcp__ombre_brain__search',
          description: 'Search memories',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          enabled: true,
        }],
      }],
    })
    expect(config.servers[0].tools?.[0].inputSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
    })
  })

  it('loads persisted MCP config through the existing Haven gateway path', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.example/root/')
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'server-mcp-secret')
    const persisted = remoteConfig('https://mcp.example/mcp')
    const upstream = vi.fn(async () => Response.json({ config: persisted }))
    vi.stubGlobal('fetch', upstream)

    const loaded = await loadMcpConfig()

    expect(loaded.servers[0].url).toBe('https://mcp.example/mcp')
    expect(upstream).toHaveBeenCalledOnce()
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://haven.example/root/gateway/api/cc/mcp')
    expect(init.headers.Authorization).toBe('Bearer server-mcp-secret')
    expect(JSON.stringify(loaded)).not.toContain('server-mcp-secret')
  })

  it.each([
    'http://localhost:18001/mcp',
    'http://127.0.0.1:18001/mcp',
    'http://[::1]:18001/mcp',
  ])('rejects production loopback MCP config %s', (url) => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => validateMcpConfig(remoteConfig(url))).toThrow('production 的 MCP URL')
  })
})
