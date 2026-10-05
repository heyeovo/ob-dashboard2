import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useDoubleConfirm } from '@/app/lib/useDoubleConfirm'

function confirmation() {
  let confirm!: ReturnType<typeof useDoubleConfirm>['confirm']
  function Harness() { confirm = useDoubleConfirm().confirm; return null }
  renderToStaticMarkup(createElement(Harness))
  return confirm
}
afterEach(() => vi.useRealTimers())
it('requires two clicks on the same target within three seconds', () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const confirm = confirmation(), action = vi.fn()
  confirm('game', action)
  expect(action).not.toHaveBeenCalled()
  vi.advanceTimersByTime(2999)
  confirm('game', action)
  expect(action).toHaveBeenCalledTimes(1)
  confirm('game', action)
  expect(action).toHaveBeenCalledTimes(1)
})
it('rejects expired clicks and does not confirm a different target', () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const confirm = confirmation(), action = vi.fn()
  confirm('module-a', action)
  confirm('module-b', action)
  expect(action).not.toHaveBeenCalled()
  vi.advanceTimersByTime(3000)
  confirm('module-b', action)
  expect(action).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  confirm('module-b', action)
  expect(action).toHaveBeenCalledTimes(1)
})
