import { afterEach, describe, expect, it, vi } from 'vitest'
import { detachedWaitExpired, fetchWithDeploymentRetry, DEPLOY_RETRY_MS, DeploymentRetryTimeout } from '@/app/cc/deploymentRetry'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('deployment retry (both chat engines)', () => {
  it('reuses the exact request body through 503 and 409 and honors their retry delays', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'server_draining', retry_after_ms: 3000 }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: 'previous_instance_finishing', retry_after_ms: 5000 }, { status: 409 }))
      .mockResolvedValueOnce(new Response('SSE'))
    vi.stubGlobal('fetch', fetch)
    const body = JSON.stringify({ request_id: 'same-request', expected_last_round_id: 7 })
    const onRetry = vi.fn()
    const pending = fetchWithDeploymentRetry('/api/cc-chat-selfhost', { method: 'POST', body }, onRetry)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await (await pending).text()).toBe('SSE')
    expect(fetch.mock.calls.every(([, init]) => init.body === body)).toBe(true)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry.mock.calls[0][0]).toBe(onRetry.mock.calls[1][0])
  })

  it('caps retry at twelve minutes and preserves other HTTP failures for existing error handling', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => Response.json({ error: 'server_draining', retry_after_ms: 3000 }, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const pending = fetchWithDeploymentRetry('/api/cc-chat', {}, () => {})
    const result = expect(pending).rejects.toBeInstanceOf(DeploymentRetryTimeout)
    await vi.advanceTimersByTimeAsync(DEPLOY_RETRY_MS)
    await result
    fetch.mockResolvedValueOnce(Response.json({ error: 'turn_running' }, { status: 409 }))
    expect((await fetchWithDeploymentRetry('/api/cc-chat', {}, () => {})).status).toBe(409)
  })

  it('aborts waiting without sending again after a window switch or explicit stop', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => Response.json({ error: 'server_draining' }, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const ac = new AbortController()
    const pending = fetchWithDeploymentRetry('/api/cc-chat', { signal: ac.signal }, () => {})
    const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    ac.abort()
    await result
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses the original retry deadline when resuming a detached pending send', async () => {
    vi.useFakeTimers(); vi.setSystemTime(DEPLOY_RETRY_MS + 1)
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(fetchWithDeploymentRetry('/api/cc-chat', {}, () => {}, 0)).rejects.toBeInstanceOf(DeploymentRetryTimeout)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps a missing detached round pending for twelve minutes before declaring it unsaved', () => {
    expect(detachedWaitExpired(1000, 1000 + DEPLOY_RETRY_MS - 1)).toBe(false)
    expect(detachedWaitExpired(1000, 1000 + DEPLOY_RETRY_MS)).toBe(true)
  })
})
