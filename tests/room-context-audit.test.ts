import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const fixture = vi.hoisted(() => {
  const content = '<rolling_window_context>\n日回顾\n【我的房间 · 今天的门牌】\n[room_abc] 私密标题\n便条：秘密\n</rolling_window_context>'
  return { content }
})
vi.mock('@/app/lib/havenTurns', () => ({ getConversationSession: vi.fn(async () => ({ ok: true, found: true, contextDays: [], session: { title: '测试', mode: 'chat', persona_id: 'p', context_revision: 1, rolling_context: { strategy: 'daily_rolling', day_modes: {} }, prompt_module_overrides: {} } })), listTurns: vi.fn(async () => ({ ok: true, turns: [] })) }))
vi.mock('@/app/lib/cc/windowPrompt', () => ({ loadRollingWindowAppend: vi.fn(async () => ({ content: fixture.content, history: [], pinnedBucketIds: [], journalIds: [], recentBucketIds: [], feelBucketIds: [], randomHighImportanceBucketIds: [] })), composeWindowPersonaAppend: vi.fn(() => fixture.content) }))
vi.mock('@/app/lib/cc/rollingArchive', () => ({ inspectRollingArchive: vi.fn(async () => null) }))
vi.mock('@/app/lib/cc/rollingHistory', () => ({ inspectRollingHistoryTranscript: vi.fn(async () => null) }))
vi.mock('@/app/lib/ccSession', () => ({ getSessionStats: vi.fn(() => ({})) }))
vi.mock('@/app/lib/havenPersonas', () => ({ getPersona: vi.fn(async () => ({ persona: {} })), buildPersonaAppend: vi.fn(() => '固定模块'), promptModulesForPersona: vi.fn(() => []) }))
vi.mock('@/app/lib/cc/systemPromptAudit', () => ({ readSystemPromptAudit: vi.fn(async () => ({ dashboardAppend: fixture.content, systemHash: 'old' })) }))
vi.mock('@/app/lib/ccMcp', () => ({ loadMcpConfig: vi.fn(async () => ({ builtIns: {} })), configuredMcpModelSurface: vi.fn(() => []), disabledMcpTools: vi.fn(() => []) }))
vi.mock('@/app/lib/cc/builtInMcp', () => ({ builtInMcpModelSurfaces: vi.fn(() => []), builtInMcpServerNames: vi.fn(() => []) }))
vi.mock('@/app/lib/cc/agentWakeTool', () => ({ agentWakeMcpAudit: vi.fn(() => ({})) }))
import { GET } from '@/app/api/cc-context-audit/route'

describe('context audit room privacy', () => {
  it('seals current append, saved latest append and rolling background at the actual browser route', async () => {
    const response = await GET(new NextRequest('https://dashboard.example/api/cc-context-audit?session_id=s'))
    const data = await response.json()
    expect(response.status).toBe(200)
    for (const content of [data.rolling.background_content, data.system_prompt.current.dashboard_append, data.system_prompt.latest.dashboard_append]) {
      expect(content).toContain('【我的房间 · 今天的门牌】已封存')
      expect(content).not.toContain('私密标题'); expect(content).not.toContain('秘密')
    }
  })
})
