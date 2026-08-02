import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeFetchError, fetchHavenWithReadRetry } from '@/app/lib/havenReadFetch'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchHavenWithReadRetry', () => {
  it('retries one transient GET failure and returns the second response', async () => {
    vi.useFakeTimers()
    const response = new Response('{}', { status: 200 })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchHavenWithReadRetry('https://haven.test/read', { method: 'GET' })
    await vi.advanceTimersByTimeAsync(250)

    await expect(pending).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry mutations', async () => {
    const failure = new TypeError('fetch failed')
    const fetchMock = vi.fn().mockRejectedValue(failure)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHavenWithReadRetry('https://haven.test/write', { method: 'POST' })).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry HTTP errors', async () => {
    const response = new Response('bad gateway', { status: 502 })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHavenWithReadRetry('https://haven.test/read', { method: 'GET' })).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry after the request is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const failure = new DOMException('aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(failure)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchHavenWithReadRetry('https://haven.test/read', {
      method: 'GET',
      signal: controller.signal,
    })).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('includes the underlying undici cause in diagnostics', () => {
    const cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    const failure = new TypeError('fetch failed', { cause })

    expect(describeFetchError(failure)).toBe('fetch failed <- UND_ERR_SOCKET: other side closed')
  })
})
