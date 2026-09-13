import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  resetSessionTurnCoordinatorForTests,
  runForegroundSessionTurn,
  tryRunBackgroundSessionTurn,
} from '@/app/lib/cc/sessionTurnCoordinator'

afterEach(() => {
  resetSessionTurnCoordinatorForTests()
  delete process.env.OB2_TEST_SUBSCRIPTION_LOCK_DIR
})

describe('SessionTurnCoordinator', () => {
  it('lets an already-running background turn finish, then starts the queued user turn', async () => {
    const order: string[] = []
    let releaseBackground!: () => void
    const background = tryRunBackgroundSessionTurn('s1', async () => {
      order.push('background:start')
      await new Promise<void>(resolve => { releaseBackground = resolve })
      order.push('background:end')
    })
    await Promise.resolve()
    const foreground = runForegroundSessionTurn('s1', async () => { order.push('foreground') })
    await Promise.resolve()
    expect(order).toEqual(['background:start'])
    releaseBackground()
    await Promise.all([background, foreground])
    expect(order).toEqual(['background:start', 'background:end', 'foreground'])
  })

  it('defers a new background wake while a foreground turn is waiting', async () => {
    let releaseFirst!: () => void
    const first = runForegroundSessionTurn('s1', () => new Promise<void>(resolve => { releaseFirst = resolve }))
    await Promise.resolve()
    const second = runForegroundSessionTurn('s1', async () => undefined)
    const wake = await tryRunBackgroundSessionTurn('s1', async () => 'should-not-run')
    expect(wake).toEqual({ status: 'deferred', reason: 'foreground_waiting' })
    releaseFirst()
    await Promise.all([first, second])
  })

  it('defers without entering the queue when the session has an approval or compaction blocker', async () => {
    const wake = await tryRunBackgroundSessionTurn('s1', async () => 'no', () => true)
    expect(wake).toEqual({ status: 'deferred', reason: 'session_blocked' })
  })

  it('serializes subscription foreground turns across different sessions', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const first = runForegroundSessionTurn('s1', async () => {
      order.push('first:start')
      await new Promise<void>(resolve => { releaseFirst = resolve })
      order.push('first:end')
    }, { subscription: true })
    await Promise.resolve()
    const second = runForegroundSessionTurn('s2', async () => { order.push('second') }, { subscription: true })
    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('defers a subscription wake while another subscription turn is active', async () => {
    let release!: () => void
    const foreground = runForegroundSessionTurn(
      's1',
      () => new Promise<void>(resolve => { release = resolve }),
      { subscription: true },
    )
    await Promise.resolve()
    const wake = await tryRunBackgroundSessionTurn(
      's2', async () => 'should-not-run', undefined, { subscription: true },
    )
    expect(wake).toEqual({ status: 'deferred', reason: 'turn_running' })
    release()
    await foreground
  })

  it('holds and releases the shared subscription lock around a foreground turn', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ob2-subscription-lock-'))
    process.env.OB2_TEST_SUBSCRIPTION_LOCK_DIR = root
    const lockPath = path.join(root, 'ob2-subscription-turn.lock')
    try {
      await runForegroundSessionTurn('s1', async () => {
        await expect(access(lockPath)).resolves.toBeUndefined()
      }, { subscription: true })
      await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
