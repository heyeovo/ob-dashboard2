import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadRolling: vi.fn(),
}))

vi.mock('@/app/lib/ccDirs', () => ({
  resolveDirs: vi.fn(async () => ({ cwd: 'C:/workspace', additionalDirectories: [] })),
  resolveWriteDirs: vi.fn(async () => []),
}))
vi.mock('@/app/lib/havenPersonas', () => ({
  getPersona: vi.fn(async () => ({ persona: { id: 'ombre', dirs: [], write_dirs: [] } })),
  buildPersonaAppend: vi.fn(() => 'persona'),
}))
vi.mock('@/app/lib/havenUpstream', () => ({ loadUpstreamConfig: vi.fn(), resolveProvider: vi.fn() }))
vi.mock('@/app/lib/havenPermissions', () => ({
  loadPermanentPermissionRules: vi.fn(async () => ({ ok: true, rules: [] })),
  permissionRuleStrings: vi.fn(() => []),
}))
vi.mock('@/app/lib/ccMcp', () => ({
  loadMcpConfig: vi.fn(async () => ({ servers: [] })),
  configuredMcpModelSurface: vi.fn(() => []),
  disabledMcpTools: vi.fn(() => []),
  toSdkMcpServers: vi.fn(() => ({})),
}))
vi.mock('@/app/lib/havenTurns', () => ({ getConversationSession: deps.getSession }))
vi.mock('@/app/lib/cc/ccOptions', () => ({
  ccLaneId: vi.fn(() => 'subscription'),
  cacheRelevantFingerprint: vi.fn(() => ({ sdkCacheRelevantOptionsHash: 'system-key' })),
  sdkModelForProvider: vi.fn((model: string) => model),
  setWriteDirs: vi.fn(),
}))
vi.mock('@/app/lib/cc/builtInMcp', () => ({ builtInMcpModelSurfaces: vi.fn(() => []) }))
vi.mock('@/app/lib/cc/windowPrompt', () => ({
  composeWindowPersonaAppend: vi.fn(() => 'composed'),
  loadRollingWindowAppend: deps.loadRolling,
}))
vi.mock('@/app/lib/ccSession', () => ({
  ccResumeHintForContext: vi.fn((input: {
    persistedHint: string
    laneContextRevision: number
    contextRevision: number
    isRolling: boolean
  }) => input.persistedHint && input.laneContextRevision === input.contextRevision
    ? input.persistedHint
    : ''),
}))
vi.mock('@/app/lib/cc/rollingHistory', () => ({
  rollingRevisionRequiresSource: vi.fn((
    isRolling: boolean, laneRevision: number, revision: number, previousStrategy: string,
  ) => isRolling && laneRevision !== revision && previousStrategy !== 'fixed_window'),
}))

import { loadBackgroundTurnInputs } from '@/app/lib/cc/turnInputs'

const rawTurn = {
  id: 1, session_id: 'window-1', round_id: 1, created_at: '2026-09-13T10:00:00Z',
  user_text: '问题', assistant_text: '回答', model: 'claude', client: 'test', route: '/test',
  source: 'cc', turn_kind: 'user', chat_day: '2026-09-13',
}

function session(laneRevision: number, contextRevision: number) {
  return {
    profile_id: 'default', session_id: 'window-1', persona_id: 'ombre', title: '',
    local_engine_preference: 'cc', selfhost_overrides: {},
    cc_overrides: { active_cred: 'subscription', subscription: { model: 'claude', thinking: true } },
    cc_lanes: { subscription: { cc_session_id: 'native-session', context_revision: laneRevision } },
    rolling_context: {
      strategy: 'daily_rolling', previous_strategy: 'daily_rolling',
      previous_day_modes: { '2026-09-13': 'raw' }, day_modes: { '2026-09-13': 'raw' },
    },
    context_revision: contextRevision, context_gc: {}, prompt_module_overrides: {}, mode: 'chat',
    frozen_persona_append_initialized: true, frozen_persona_append: '', handoff_snapshot: {},
    cc_seen_round_id: 1, state_version: 1, deleted_at: null, updated_at: '',
  }
}

beforeEach(() => {
  deps.getSession.mockReset()
  deps.loadRolling.mockReset()
  deps.loadRolling.mockResolvedValue({
    history: [rawTurn], allTurns: [rawTurn], content: '', pinnedBucketIds: [],
  })
})

describe('background rolling turn inputs', () => {
  it('resumes the complete transcript for the same rolling revision', async () => {
    deps.getSession.mockResolvedValue({
      ok: true, session: session(2, 2), contextDays: [], bucketExclusionIds: [],
    })

    const loaded = await loadBackgroundTurnInputs('window-1')

    expect(loaded.resumeHint).toBe('native-session')
    expect(loaded.config.rollingSourceResumeFrom).toBeUndefined()
    expect(loaded.config.allowRollingBodySeed).toBe(false)
    expect(deps.loadRolling).toHaveBeenCalledWith(
      'window-1', expect.any(Object), [], { includeAllTurns: false },
    )
  })

  it('requires the old complete transcript when a background wake crosses a rolling revision', async () => {
    deps.getSession.mockResolvedValue({
      ok: true, session: session(1, 2), contextDays: [], bucketExclusionIds: [],
    })

    const loaded = await loadBackgroundTurnInputs('window-1')

    expect(loaded.resumeHint).toBe('')
    expect(loaded.config.rollingSourceResumeFrom).toBe('native-session')
    expect(loaded.config.requireRollingSource).toBe(true)
    expect(loaded.config.rollingAllHistory).toEqual([rawTurn])
    expect(loaded.config.rollingRequiredFullRawDays).toEqual(['2026-09-13'])
    expect(deps.loadRolling).toHaveBeenCalledWith(
      'window-1', expect.any(Object), [], { includeAllTurns: true },
    )
  })
})
