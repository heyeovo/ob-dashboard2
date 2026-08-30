import { describe, expect, it } from 'vitest'
import {
  estimateContextTokens,
  estimateMcpConfigTokens,
  estimateMcpServerTokens,
  estimateMcpToolTokens,
} from '@/app/lib/contextTokenEstimate'
import type { CcMcpConfig, CcMcpServer } from '@/app/lib/ccMcpTypes'

const server: CcMcpServer = {
  name: 'demo',
  label: 'Demo',
  enabled: true,
  transport: 'http',
  url: 'https://example.com/mcp',
  permission: 'ask',
  saveResults: true,
  tools: [
    {
      name: 'mcp__demo__search',
      description: '搜索资料',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: '关键词' } },
        required: ['query'],
      },
      enabled: true,
    },
    {
      name: 'mcp__demo__write',
      description: '写入资料',
      inputSchema: { type: 'object', properties: { content: { type: 'string' } } },
      enabled: false,
    },
  ],
}

describe('context token estimates', () => {
  it('uses the same conservative CJK weighting as handoff', () => {
    expect(estimateContextTokens('中文')).toBeGreaterThan(estimateContextTokens('ab'))
  })

  it('counts name, description and input schema for a tool', () => {
    const withSchema = estimateMcpToolTokens(server.tools![0])
    const withoutSchema = estimateMcpToolTokens({ ...server.tools![0], inputSchema: undefined })
    expect(withSchema).toBeGreaterThan(withoutSchema)
  })

  it('reacts to server and tool switches without counting disabled definitions', () => {
    const config: CcMcpConfig = { version: 1, servers: [server] }
    const searchTokens = estimateMcpToolTokens(server.tools![0])
    expect(estimateMcpServerTokens(server)).toBe(searchTokens)
    expect(estimateMcpConfigTokens(config)).toBe(searchTokens)
    expect(estimateMcpConfigTokens({ version: 1, servers: [{ ...server, enabled: false }] })).toBe(0)
  })
})
