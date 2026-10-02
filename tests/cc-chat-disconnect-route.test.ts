import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const executor = vi.hoisted(() => ({ run: vi.fn(), record: vi.fn() }))
vi.mock('@/app/lib/cc/runTurn', () => ({ runTurn: executor.run, setRecallPrefs: vi.fn(), clearRecallPrefs: vi.fn() }))
vi.mock('@/app/lib/havenTurns', () => ({
  getTurnByRequestId: vi.fn(async () => ({ ok: true, found: false })),
  patchConversationSessionState: vi.fn(async () => ({ ok: true })),
  getConversationSession: vi.fn(async () => ({ ok: true, session: {
    frozen_persona_append_initialized: true, state_version: 1,
  }, contextDays: [], bucketExclusionIds: [] })),
}))
vi.mock('@/app/lib/havenPersonas', () => ({ getPersona: vi.fn(async () => ({ persona: null })), buildPersonaAppend: vi.fn(() => '') }))
vi.mock('@/app/lib/havenUpstream', () => ({ loadUpstreamConfig: vi.fn(async () => ({ ok: false })), resolveProvider: vi.fn() }))
vi.mock('@/app/lib/havenPermissions', () => ({ loadPermanentPermissionRules: vi.fn(async () => ({ ok: false })), permissionRuleStrings: vi.fn(() => []) }))
vi.mock('@/app/lib/ccMcp', () => ({
  loadMcpConfig: vi.fn(async () => ({ builtIns: {} })), configuredMcpModelSurface: vi.fn(() => []),
  toSdkMcpServers: vi.fn(() => ({})), disabledMcpTools: vi.fn(() => []),
}))
vi.mock('@/app/lib/ccDirs', () => ({
  READ_ONLY_TOOLS: [], WRITE_TOOLS: [],
  builtInWorkDirs: vi.fn(() => []), resolveDirs: vi.fn(async () => ({ cwd: process.cwd(), additionalDirectories: [] })),
  resolveWriteDirs: vi.fn(async () => []),
}))
vi.mock('@/app/lib/havenAttachments', () => ({ resolveAttachments: vi.fn(async () => []) }))
vi.mock('@/app/lib/cc/windowPrompt', () => ({
  loadRollingWindowAppend: vi.fn(async () => ({ content: '', pinnedBucketIds: [] })),
  composeWindowPersonaAppend: vi.fn(() => ''),
}))

import { POST, GET, DELETE } from '@/app/api/cc-chat/route'
import { GET as attach } from '@/app/api/cc-chat/attach/route'
import { POST as stop } from '@/app/api/cc-stop/route'
import { getTurnBroadcast } from '@/app/lib/cc/turnBroadcast'
import { configureServerDrain, resetServerDrainForTests, startDrain } from '@/app/lib/serverDrain'

afterEach(() => { resetServerDrainForTests(); vi.clearAllMocks() })
function request(sessionId: string, signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/cc-chat', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, request_id: `r-${sessionId}`,
      persona_id: 'ombre', text: 'hello', expected_last_round_id: 0 }),
  })
}

describe('cc route disconnect lifecycle', () => {
  it('rejects a new turn during drain but keeps same-request replay, attach, stats and stop available', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    executor.run.mockImplementation(async input => {
      input.send('start', { request_id: input.requestId })
      await pending
      input.send('done', { round_id: 1 })
    })
    const response = await POST(request('drain-existing'))
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce())
    configureServerDrain({ exit: vi.fn() })
    startDrain('SIGTERM')
    const rejected = await POST(request('drain-new'))
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toMatchObject({ error: 'server_draining', retry_after_ms: 3000 })
    const replay = await POST(request('drain-existing'))
    expect(replay.status).toBe(200)
    const attached = attach(new NextRequest('http://localhost/api/cc-chat/attach?session_id=drain-existing&request_id=r-drain-existing'))
    expect(attached.status).toBe(200)
    const stats = await GET(new NextRequest('http://localhost/api/cc-chat?session_id=drain-existing'))
    expect((await stats.json()).active_turn.request_id).toBe('r-drain-existing')
    expect((await stop(new NextRequest('http://localhost/api/cc-stop', { method: 'POST', body: JSON.stringify({ session_id: 'drain-existing' }) }))).status).toBe(200)
    expect(executor.run).toHaveBeenCalledOnce()
    release()
    await Promise.all([response.text(), replay.text(), attached.text()])
  })
  it('keeps a request-independent signal, advertises active turn, completes and replays after disconnect', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    executor.run.mockImplementation(async input => {
      input.send('start', { request_id: input.requestId })
      input.send('delta', { text: 'partial' })
      await pending
      expect(input.signal.aborted).toBe(false)
      executor.record('Haven saved')
      input.send('done', { round_id: 1 })
      input.close()
    })
    const controller = new AbortController()
    const response = await POST(request('disconnect-route', controller.signal))
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce())
    controller.abort()
    expect(getTurnBroadcast('disconnect-route')!.controller.signal.aborted).toBe(false)
    const status = await GET(new NextRequest('http://localhost/api/cc-chat?session_id=disconnect-route'))
    expect((await status.json()).active_turn).toMatchObject({ request_id: 'r-disconnect-route', user_text: 'hello' })
    release()
    await vi.waitFor(() => expect(getTurnBroadcast('disconnect-route')!.done).toBe(true))
    expect(executor.record).toHaveBeenCalledOnce()
    const replay = attach(new NextRequest('http://localhost/api/cc-chat/attach?session_id=disconnect-route&request_id=r-disconnect-route&after_seq=1'))
    expect(await replay.text()).toContain('event: done')
  })

  it('explicit DELETE still cancels the server-owned turn signal', async () => {
    executor.run.mockImplementation(async input => {
      await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    const response = await POST(request('delete-route'))
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce())
    await DELETE(new NextRequest('http://localhost/api/cc-chat?session_id=delete-route', { method: 'DELETE' }))
    expect(getTurnBroadcast('delete-route')!.controller.signal.aborted).toBe(true)
    await response.body!.cancel()
    await vi.waitFor(() => expect(getTurnBroadcast('delete-route')!.done).toBe(true))
  })

  it('stop cancels a queued turn even when no SDK session exists yet', async () => {
    const { runForegroundSessionTurn } = await import('@/app/lib/cc/sessionTurnCoordinator')
    let release!: () => void, entered = false
    const pending = new Promise<void>(resolve => { release = resolve })
    const occupied = runForegroundSessionTurn('queued-stop', async () => { entered = true; await pending })
    await vi.waitFor(() => expect(entered).toBe(true))
    const stream = await POST(request('queued-stop'))
    const turn = getTurnBroadcast('queued-stop')!
    expect(turn.executing).toBe(false)
    expect(executor.run).not.toHaveBeenCalled()
    const response = await stop(new NextRequest('http://localhost/api/cc-stop', { method: 'POST',
      body: JSON.stringify({ session_id: turn.sessionId }) }))
    expect(response.status).toBe(200)
    expect(turn.controller.signal.aborted).toBe(true)
    expect(await stream.text()).toContain('cancelled')
    expect(executor.run).not.toHaveBeenCalled()
    release()
    await occupied
  })})
