import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGptConnection } from '@/app/cc/useGptConnection'

const connected = { ok: true, configured: true, status: 'connected', sharing: true, login_method: 'local_ssh_import',
  limits: null, usage_url: 'https://chatgpt.com/settings/usage', connection_id: 'c1' }
function mount() {
  let account!: ReturnType<typeof useGptConnection>
  function Harness() { account = useGptConnection(false); return null }
  renderToStaticMarkup(createElement(Harness))
  return account
}
afterEach(() => vi.unstubAllGlobals())
describe('GPT reads current authorization and model choices only', () => {
  it('uses the fixed Cookie GET routes with no browser Bearer or account-management request', async () => {
    const fetcher = vi.fn(async (url: string, _init: RequestInit) => Response.json(url.endsWith('/connection') ? connected
      : { ok: true, models: [{ slug: 'real', displayName: 'Real' }] }))
    vi.stubGlobal('fetch', fetcher)
    await mount().reload()
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/gpt-subscription/connection', '/api/gpt-subscription/models'])
    for (const [, init] of fetcher.mock.calls) {
      expect(init.cache).toBe('no-store')
      expect(init.headers).toBeUndefined()
      expect(init.body).toBeUndefined()
      expect(init.method).toBeUndefined()
    }
  })
  it.each([
    { ...connected, configured: false }, { ...connected, sharing: false }, { ...connected, status: 'reauth_required' },
    { ...connected, error: { code: 'storage_error', message: 'check storage', action: 'inspect', retryable: false } },
  ])('does not fetch models when connection facts prohibit use', async state => {
    const fetcher = vi.fn(async () => Response.json(state))
    vi.stubGlobal('fetch', fetcher)
    await mount().reload()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('drops an obsolete read rather than loading models from its old account', async () => {
    let finish!: (response: Response) => void
    let first = true
    const fetcher = vi.fn(async (url: string, _init: RequestInit) => {
      if (first) { first = false; return new Promise<Response>(resolve => { finish = resolve }) }
      return Response.json(url.endsWith('/connection') ? connected : { ok: true, models: [] })
    })
    vi.stubGlobal('fetch', fetcher)
    const account = mount(); const oldRead = account.reload()
    await account.reload()
    finish(Response.json(connected)); await oldRead
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true)
    expect(fetcher.mock.calls.filter(call => call[0].endsWith('/models'))).toHaveLength(1)
  })
  it('handles a page-login or network failure without calling models or exposing raw diagnostics', async () => {
    const fetcher = vi.fn(async () => new Response('<html>login required</html>', { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(mount().reload()).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
