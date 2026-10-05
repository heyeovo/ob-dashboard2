import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildTrpgPrompt, runYanzhiTurn, trpgPublicError } from '@/app/lib/trpg/yanzhiTurn'
import type { YanzhiView, YanzhiRuntime } from '@/app/lib/trpg/server'

vi.mock('@/app/lib/trpg/seatContext', () => ({ loadSeatContext: vi.fn(async () => 'BACKGROUND') }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
vi.mock('@/app/lib/cc/sessionTurnCoordinator', () => ({ runForegroundSubscriptionTurn: vi.fn(async (run: () => Promise<unknown>) => run()) }))
vi.mock('@/app/lib/cc/ccOptions', () => ({ thinkingConfigForModel: () => ({ type: 'adaptive' }) }))
vi.mock('@/app/lib/ccEnv', () => ({ buildCcEnv: () => ({}) }))
vi.mock('@/app/lib/havenConfig', () => ({ getHavenBaseUrl: () => 'http://haven.test', joinHavenUrl: (base: string, path: string) => base + path }))
vi.mock('@/app/lib/havenPersonas', () => ({ getPersona: vi.fn(async () => ({ ok: true, persona: { name: '言之' } })), buildPersonaAppend: () => 'FULL_PERSONA' }))
vi.mock('@/app/lib/havenUpstream', () => ({ loadUpstreamConfig: async () => ({ config: { default_effort: 'max', default_thinking: true } }) }))
vi.mock('@/app/lib/ccMcp', () => ({
  loadMcpConfig: async () => ({ servers: [{ name: 'ombre_brain', enabled: true, tools: [{ name: 'mcp__ombre_brain__save', enabled: true }, { name: 'mcp__ombre_brain__hidden', enabled: false }] }, { name: 'yanzhi', enabled: true }, { name: 'ombre_agent_wake', enabled: true }] }),
  toSdkMcpServers: (config: { servers: { name: string }[] }) => Object.fromEntries(config.servers.map(server => [server.name, { type: 'http', url: 'http://ob.test' }])),
  disabledMcpTools: () => ['mcp__ombre_brain__hidden'],
}))
const view: YanzhiView = { id: 'g', title: 'fake', phase: 'yanzhi', scene: null, my_character: { name: '测试乙', occupation: '记者', notes: 'FULL_SHEET' }, companions: [], clues: [{ id: 'c', title: '线索', text: 'PUBLIC_CLUE', handout: true }], checks: [], latest_recap: { public: 'PUBLIC_RECAP' }, log: [1, 2].map(seq => ({ seq, author: 'xiaoyang', kind: 'table_talk', text: `LOG_${seq}`, created_at: '' })) }
const runtime: YanzhiRuntime = { session_id: 'old', session_tokens: 100, last_seen_seq: 1, last_error: null, running_since: null }
function stream(error?: string) {
  return Object.assign((async function* () {
    if (error) throw new Error(error)
    yield { type: 'system', subtype: 'init', session_id: 'new' }
    yield { type: 'assistant', message: { content: [{ type: 'text', text: '工具前言' }] } }
    yield { type: 'result', subtype: 'success', session_id: 'new', result: '最后回复', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } }
  })(), { close: vi.fn() })
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('TRPG_PLAYER_MCP_TOKEN', 'fake-player-token'); vi.mocked(query).mockImplementation(() => stream() as unknown as ReturnType<typeof query>) })
afterEach(() => vi.unstubAllEnvs())

it('seeds new sessions but supplies only incremental logs to resumed sessions', () => {
  const fresh = buildTrpgPrompt('action', view, runtime, true)
  for (const content of ['FULL_SHEET', 'PUBLIC_RECAP', 'PUBLIC_CLUE', 'LOG_1', 'LOG_2']) expect(fresh).toContain(content)
  const old = buildTrpgPrompt('table_talk', view, runtime, false)
  expect(old).toContain('LOG_2')
  for (const content of ['FULL_SHEET', 'PUBLIC_RECAP', 'PUBLIC_CLUE', 'LOG_1']) expect(old).not.toContain(content)
})
it('uses only TRPG and OB with no native tools, and saves final reply and last usage', async () => {
  expect(await runYanzhiTurn('action', view, runtime, { yanzhi_model: 'claude-opus-4-6', persona_id: '' })).toEqual({ text: '最后回复', session_id: 'new', session_tokens: 60 })
  const options = vi.mocked(query).mock.calls[0][0].options!
  expect(Object.keys(options.mcpServers!)).toEqual(['ombre_brain', 'trpg'])
  expect(options.tools).toEqual([])
  expect(options.allowedTools).toEqual(['mcp__trpg__*', 'mcp__ombre_brain__save'])
  expect(options.disallowedTools).toEqual(['mcp__ombre_brain__hidden'])
  expect(options.settings).toEqual({ autoMemoryEnabled: false })
  expect(options.settingSources).toEqual([])
  expect(options.strictMcpConfig).toBe(true)
  expect(options.resume).toBe('old')
  expect(options.effort).toBe('max')
  expect(options.systemPrompt).toMatchObject({ type: 'custom', snapshot: false })
  expect(JSON.stringify(options.systemPrompt)).toContain('FULL_PERSONA')
  for (const forbidden of ['Read', 'Bash', 'Web', 'room', 'wake', "yanzhi's files"]) expect(JSON.stringify(options.allowedTools)).not.toContain(forbidden)
})
it('reopens once on a missing resume and seeds the new session', async () => {
  vi.mocked(query).mockReturnValueOnce(stream('No conversation found') as unknown as ReturnType<typeof query>)
  await runYanzhiTurn('action', view, runtime, { yanzhi_model: 'claude-opus-4-6', persona_id: '' })
  expect(query).toHaveBeenCalledTimes(2)
  expect(vi.mocked(query).mock.calls[1][0].options!.resume).toBeUndefined()
  expect(vi.mocked(query).mock.calls[1][0].prompt).toContain('FULL_SHEET')
})
it('reopens sessions exceeding 80000 tokens', async () => {
  await runYanzhiTurn('roll', view, { ...runtime, session_tokens: 80001 }, { yanzhi_model: 'claude-sonnet-5', persona_id: '' })
  expect(vi.mocked(query).mock.calls[0][0].options!.resume).toBeUndefined()
})
it.each([['usage limit', '额度'], ['authentication_failed', '登录'], ['timeout', '超时']])('localizes %s', (error, expected) => expect(trpgPublicError(new Error(error))).toContain(expected))
it('closes the SDK stream on failure', async () => {
  const failed = stream('authentication_failed')
  vi.mocked(query).mockReturnValueOnce(failed as unknown as ReturnType<typeof query>)
  await expect(runYanzhiTurn('action', view, runtime, { yanzhi_model: 'claude-opus-4-6', persona_id: '' })).rejects.toThrow('authentication_failed')
  expect(failed.close).toHaveBeenCalled()
})


it('aborts and closes a model turn after five minutes', async () => {
  vi.useFakeTimers()
  const close = vi.fn()
  vi.mocked(query).mockImplementationOnce(({ options }) => Object.assign((async function* () {
    await new Promise<void>((_resolve, reject) => options!.abortController!.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))
  })(), { close }) as unknown as ReturnType<typeof query>)
  try {
    const turn = runYanzhiTurn('action', view, runtime, { yanzhi_model: 'claude-opus-4-6', persona_id: '' })
    const rejected = expect(turn).rejects.toThrow('timeout')
    await vi.waitFor(() => expect(query).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(300000)
    await rejected
    expect(close).toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('injects real life context only before the fresh character card', () => {
  const fresh = buildTrpgPrompt('action', view, runtime, true, 'BACKGROUND')
  expect(fresh.indexOf('BACKGROUND')).toBeLessThan(fresh.indexOf('角色卡全文'))
  expect(buildTrpgPrompt('action', view, runtime, false, 'BACKGROUND')).not.toContain('BACKGROUND')
})
