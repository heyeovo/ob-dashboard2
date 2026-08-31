import { afterEach, describe, expect, it } from 'vitest'
import {
  resetSessionTurnCoordinatorForTests,
  runForegroundSessionTurn,
  tryRunBackgroundSessionTurn,
} from '@/app/lib/cc/sessionTurnCoordinator'

afterEach(() => resetSessionTurnCoordinatorForTests())

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
})
