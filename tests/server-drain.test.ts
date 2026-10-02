import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureServerDrain, drainRejection, isDraining, previousInstanceFinishing,
  resetServerDrainForTests, startDrain, trackDrainWork, DRAIN_MARKER_TTL_MS } from '@/app/lib/serverDrain'
import { tryRunBackgroundSessionTurn } from '@/app/lib/cc/sessionTurnCoordinator'
import { GET as health } from '@/app/api/health/route'
import { NextRequest } from 'next/server'
import { POST as compact } from '@/app/api/cc-compact/route'
import { POST as gc } from '@/app/api/cc-context-gc/route'
import { POST as recovery } from '@/app/api/cc-rolling-recovery/route'
import { POST as selfhost } from '@/app/api/cc-chat-selfhost/route'
import { POST as automation } from '@/app/api/automation-pro-runner/route'

let dir: string
let exit: ReturnType<typeof vi.fn<() => void>>
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
  dir = mkdtempSync(path.join(tmpdir(), 'ob-drain-'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', dir)
  exit = vi.fn()
  configureServerDrain({ exit })
})
afterEach(() => {
  resetServerDrainForTests()
  vi.useRealTimers(); vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})
function marker(sessionId: string) { return path.join(dir, 'ob2-drain', `${encodeURIComponent(sessionId)}.json`) }
function externalMarker(age: number) {
  mkdirSync(path.join(dir, 'ob2-drain'), { recursive: true })
  writeFileSync(marker('external'), JSON.stringify({ sessionId: 'external', requestId: 'r', pid: 1,
    startedAt: Date.now() - age, drainStartedAt: Date.now() - age }))
}

describe('server drain lifecycle', () => {
  it('makes health unhealthy and exits an idle process after the final two-second flush', async () => {
    expect(health().status).toBe(200)
    startDrain('SIGTERM')
    expect(isDraining()).toBe(true)
    expect(health().status).toBe(503)
    expect(drainRejection('s')?.status).toBe(503)
    await vi.advanceTimersByTimeAsync(1999)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('waits through final persistence, removes the session marker on completion and handles repeated signals once', async () => {
    const stopSchedulers = vi.fn()
    configureServerDrain({ stopSchedulers })
    const finish = trackDrainWork({ sessionId: 'a/../b', requestId: 'request' })
    startDrain('SIGTERM'); startDrain('SIGINT')
    expect(stopSchedulers).toHaveBeenCalledOnce()
    expect(JSON.parse(readFileSync(marker('a/../b'), 'utf8'))).toMatchObject({
      sessionId: 'a/../b', requestId: 'request', pid: process.pid, drainStartedAt: Date.now(),
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(exit).not.toHaveBeenCalled()
    finish()
    expect(existsSync(marker('a/../b'))).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('stops at the deadline without blocking the extra 20-second cap on a hung stop promise', async () => {
    vi.stubEnv('DRAIN_TIMEOUT_MS', '5000')
    const stop = vi.fn(() => new Promise<void>(() => {}))
    trackDrainWork({ sessionId: 'hung', requestId: 'r', stop })
    startDrain('SIGTERM')
    await vi.advanceTimersByTimeAsync(5000)
    expect(stop).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(19_999)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledOnce()
    expect(existsSync(marker('hung'))).toBe(false)
  })

  it('finishes promptly when graceful stop saves the round before its cap', async () => {
    vi.stubEnv('DRAIN_TIMEOUT_MS', '1000')
    const finish = trackDrainWork({ sessionId: 'stopped', requestId: 'r', stop: () => finish() })
    startDrain('SIGTERM')
    await vi.advanceTimersByTimeAsync(4000)
    expect(exit).toHaveBeenCalledOnce()
  })

  it('checks registry/coordinator fallback work and cleans its marker after it becomes idle', async () => {
    let busy = true
    configureServerDrain({ busy: () => busy, activeSessions: () => busy ? [{ sessionId: 'fallback', requestId: 'wake', startedAt: Date.now() }] : [] })
    startDrain('SIGTERM')
    await vi.advanceTimersByTimeAsync(3000)
    expect(exit).not.toHaveBeenCalled()
    busy = false
    await vi.advanceTimersByTimeAsync(3000)
    expect(exit).toHaveBeenCalledOnce()
    expect(existsSync(marker('fallback'))).toBe(false)
  })

  it('retains a shared marker until all work in the session finishes', () => {
    const one = trackDrainWork({ sessionId: 'same', requestId: 'one' })
    const two = trackDrainWork({ sessionId: 'same', requestId: 'two' })
    startDrain('SIGTERM')
    one(); expect(existsSync(marker('same'))).toBe(true)
    two(); expect(existsSync(marker('same'))).toBe(false)
  })

  it('does not remove another instance marker even when container PIDs coincide', () => {
    trackDrainWork({ sessionId: 'owner', requestId: 'r' })
    startDrain('SIGTERM')
    writeFileSync(marker('owner'), JSON.stringify({ sessionId: 'owner', pid: process.pid,
      requestId: 'other', drainStartedAt: Date.now() + 1 }))
    resetServerDrainForTests()
    expect(existsSync(marker('owner'))).toBe(true)
  })
})

describe('cross-container admission', () => {
  it('guards compression, Context GC, rolling recovery and selfhost routes with fresh 409 and drain 503', async () => {
    const request = () => new NextRequest('http://localhost/api/cc-task', { method: 'POST',
      body: JSON.stringify({ session_id: 'external', request_id: 'r', text: 'hello', persona_id: 'ombre',
        expected_last_round_id: 0, lane_id: 'subscription', confirm: 'external' }) })
    externalMarker(0)
    for (const route of [compact, gc, recovery, selfhost]) {
      const response = await route(request())
      expect(response.status).toBe(409)
      expect((await response.json()).error).toBe('previous_instance_finishing')
    }
    startDrain('SIGTERM')
    for (const route of [compact, gc, recovery, selfhost]) expect((await route(request())).status).toBe(503)
  })

  it('rejects authenticated automation with a retryable 503 before starting the model', async () => {
    vi.stubEnv('OMBRE_AUTOMATION_PRO_RUNNER_TOKEN', 'test-token')
    startDrain('SIGTERM')
    const response = await automation(new Request('http://localhost/api/automation-pro-runner', { method: 'POST',
      headers: { Authorization: 'Bearer test-token' }, body: '{}' }))
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('3')
    expect(await response.json()).toMatchObject({ error_code: 'server_draining', retryable: true })
  })
  it('returns 409/deferred for a fresh marker and clears one older than eleven minutes', async () => {
    externalMarker(60_000)
    expect(previousInstanceFinishing('external')).toBe(true)
    const response = drainRejection('external')!
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'previous_instance_finishing', retry_after_ms: 5000 })
    const run = vi.fn(async () => 'value')
    expect(await tryRunBackgroundSessionTurn('external', run)).toEqual({ status: 'deferred', reason: 'previous_instance_finishing' })
    expect(run).not.toHaveBeenCalled()
    externalMarker(DRAIN_MARKER_TTL_MS + 1)
    expect(previousInstanceFinishing('external')).toBe(false)
    expect(existsSync(marker('external'))).toBe(false)
    expect((await tryRunBackgroundSessionTurn('external', run)).status).toBe('started')
  })

  it('defers new wake work while draining without executing it', async () => {
    startDrain('SIGTERM')
    const run = vi.fn()
    expect(await tryRunBackgroundSessionTurn('s', run)).toEqual({ status: 'deferred', reason: 'server_draining' })
    expect(run).not.toHaveBeenCalled()
  })
})
