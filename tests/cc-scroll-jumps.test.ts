import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drive the real scroll component through separate event and layout commits.
// This reproduces history arriving after the calendar has requested a jump.
const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], states: [] as unknown[],
  refIndex: 0, stateIndex: 0,
  layouts: [] as (() => unknown)[], effects: [] as (() => unknown)[],
}))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: (value: unknown) => {
      const index = hooks.refIndex++
      return hooks.refs[index] ??= { current: value }
    },
    useState: (value: unknown) => {
      const index = hooks.stateIndex++
      if (!(index in hooks.states)) hooks.states[index] = value
      return [hooks.states[index], (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next
      }]
    },
    useCallback: (callback: unknown) => callback,
    useLayoutEffect: (callback: () => unknown) => { hooks.layouts.push(callback) },
    useEffect: (callback: () => unknown) => { hooks.effects.push(callback) },
  }
})

import { CcScrollJumps } from '@/app/cc/CcMessageStream'

describe('calendar scroll positioning', () => {
  const listeners = new Map<string, (event: unknown) => void>()
  let targetDay = ''
  const node = {
    scrollTop: 0, scrollHeight: 2000, clientHeight: 300,
    getBoundingClientRect: () => ({ top: 10, left: 0, width: 400 }),
    querySelector: (selector: string) => selector === `[id="chat-day-${targetDay}"]`
      ? { getBoundingClientRect: () => ({ top: 10 + 300 - node.scrollTop }) } : null,
    contains: () => false,
    querySelectorAll: () => [],
  }
  const props = {
    children: 'latest messages', sessionId: 'session-a', firstMessageId: 'latest-first',
    lastMessageId: 'last', lastMessageVersion: 'last', pendingCount: 0, layoutKey: 'normal',
  }
  function render(next = props) {
    hooks.refIndex = 0; hooks.stateIndex = 0
    hooks.layouts = []; hooks.effects = []
    CcScrollJumps(next)
    hooks.refs[0].current = node
    hooks.layouts.forEach(callback => callback())
  }
  function jump(day: string) {
    listeners.get('cc-jump-to-day')!({ detail: day })
  }
  beforeEach(() => {
    hooks.refs = []; hooks.states = []
    listeners.clear(); targetDay = ''; node.scrollTop = 0; node.scrollHeight = 2000
    vi.stubGlobal('window', {
      addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
      removeEventListener: () => {},
    })
    vi.stubGlobal('document', { elementFromPoint: () => null })
    vi.stubGlobal('ResizeObserver', undefined)
    render()
    hooks.effects.forEach(callback => callback())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retains a jump until a later history render, instead of returning to the latest messages', () => {
    jump('2026-09-20')
    render()
    expect(node.scrollTop).toBe(2000)
    targetDay = '2026-09-20'; node.scrollHeight = 5000
    render({ ...props, children: 'history and latest', firstMessageId: 'history-first' })
    expect(node.scrollTop).toBe(300)
  })

  it('jumps to already rendered history, including a repeated selection', () => {
    targetDay = '2026-09-20'
    jump(targetDay); render()
    expect(node.scrollTop).toBe(300)
    node.scrollTop = 900
    jump(targetDay); render()
    expect(node.scrollTop).toBe(300)
  })

  it('drops a pending date when switching conversations', () => {
    jump('2026-09-20'); render()
    targetDay = '2026-09-20'; node.scrollHeight = 4000
    render({ ...props, sessionId: 'session-b' })
    expect(node.scrollTop).toBe(4000)
  })

  it('preserves the viewport on ordinary history prepend without a calendar request', () => {
    node.scrollTop = 900; listeners.get('resize')!({})
    node.scrollHeight = 5000
    render({ ...props, children: 'older and latest', firstMessageId: 'older-first' })
    expect(node.scrollTop).toBe(3900)
  })
})
