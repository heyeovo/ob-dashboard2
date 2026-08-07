import { describe, expect, it } from 'vitest'
import { isSelfhostMcpServer, isSelfhostMcpToolAllowed } from '@/app/lib/selfhost/mcp'
import type { CcMcpServer } from '@/app/lib/ccMcpTypes'

function server(overrides: Partial<CcMcpServer> = {}): CcMcpServer {
  return {
    name: 'remote',
    label: 'Remote',
    enabled: true,
    transport: 'http',
    url: 'https://example.com/mcp',
    permission: 'allow',
    saveResults: true,
    tools: [{ name: 'mcp__remote__read', enabled: true }],
    ...overrides,
  }
}

describe('selfhost MCP permission boundary', () => {
  it('accepts only enabled HTTP/SSE servers', () => {
    expect(isSelfhostMcpServer(server({ transport: 'http' }))).toBe(true)
    expect(isSelfhostMcpServer(server({ transport: 'sse' }))).toBe(true)
    expect(isSelfhostMcpServer(server({ transport: 'stdio', command: 'node', url: undefined }))).toBe(false)
    expect(isSelfhostMcpServer(server({ enabled: false }))).toBe(false)
  })

  it('injects only enabled tools whose effective permission is allow', () => {
    expect(isSelfhostMcpToolAllowed(server(), 'mcp__remote__read')).toBe(true)
    expect(isSelfhostMcpToolAllowed(server({ permission: 'ask' }), 'mcp__remote__read')).toBe(false)
    expect(isSelfhostMcpToolAllowed(server({ permission: 'deny' }), 'mcp__remote__read')).toBe(false)
    expect(isSelfhostMcpToolAllowed(server({
      permission: 'ask',
      toolPermissions: { mcp__remote__read: 'allow' },
    }), 'mcp__remote__read')).toBe(true)
    expect(isSelfhostMcpToolAllowed(server({
      tools: [{ name: 'mcp__remote__read', enabled: false }],
    }), 'mcp__remote__read')).toBe(false)
  })
})
