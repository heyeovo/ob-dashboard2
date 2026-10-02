import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0, layouts: [] as (() => void | (() => void))[] }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual,
    useRef: (value: unknown) => hooks.refs[hooks.index++] ??= { current: value },
    useState: (value: unknown) => [value, () => {}],
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
    useLayoutEffect: (callback: () => void | (() => void)) => { hooks.layouts.push(callback) },
  }
})
import DetailPanel from '@/app/components/DetailPanel'

type Node = { type: unknown; props: { children: Node[] | Node; ref?: { current: unknown } } }

describe('bucket opt-in drawer viewport', () => {
  const overlay = { style: {} as Record<string, string> }
  const sheet = { style: {} as Record<string, string>, getBoundingClientRect: () => ({ height: 600 }) }
  const listeners = new Map<string, () => void>()
  const viewport = { height: 800, offsetTop: 0,
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  }
  let desktop = false
  function render(keyboardAware: boolean, preserveHeight: boolean) {
    hooks.index = 0; hooks.layouts = []
    const fragment = DetailPanel({ open: true, onClose: () => {}, children: 'body', keyboardAware, preserveHeight }) as unknown as Node
    const drawer = Array.isArray(fragment.props.children) ? fragment.props.children[0] : fragment.props.children
    const portal = (drawer.type as (props: unknown) => Node)(drawer.props)
    const root = portal.props.children as Node
    const mobile = (root.props.children as Node[])[2]
    root.props.ref!.current = overlay
    mobile.props.ref!.current = sheet
    return hooks.layouts.map(callback => callback())
  }
  beforeEach(() => {
    hooks.refs = []; listeners.clear(); overlay.style = {}; sheet.style = {}
    desktop = false; viewport.height = 800; viewport.offsetTop = 0
    vi.stubGlobal('window', { visualViewport: viewport, innerHeight: 800,
      matchMedia: () => ({ matches: desktop }), addEventListener: () => {}, removeEventListener: () => {},
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('preserves the reading sheet height on entering edit, then fits the panned keyboard viewport', () => {
    render(false, false)
    const cleanups = render(true, true)
    expect(sheet.style.height).toBe('600px')
    viewport.height = 350; viewport.offsetTop = 60
    listeners.get('resize')!()
    expect(overlay.style).toMatchObject({ top: '60px', height: '350px', bottom: 'auto' })
    expect(sheet.style.maxHeight).toBe('308px')
    expect(350 - Number.parseFloat(sheet.style.maxHeight)).toBeGreaterThan(0)
    cleanups.forEach(cleanup => cleanup?.())
    expect(listeners.size).toBe(0)
  })

  it('does not adapt other drawers that use the default options', () => {
    render(false, false)
    expect(listeners.size).toBe(0)
    expect(overlay.style.height).toBe('')
    expect(sheet.style.maxHeight).toBe('88vh')
    expect(sheet.style.height).toBe('')
  })

  it('restores normal sizing on leaving edit and leaves desktop positioning alone', () => {
    render(false, false); render(true, true)
    desktop = true; listeners.get('resize')!()
    expect(overlay.style.top).toBe('')
    expect(overlay.style.height).toBe('')
    render(false, false)
    expect(sheet.style.height).toBe('')
    expect(sheet.style.maxHeight).toBe('88vh')
  })
})
