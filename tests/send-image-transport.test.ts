import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('node:http', () => ({ request: mocks.request }))
vi.mock('node:https', () => ({ request: mocks.request }))
import { downloadImage } from '@/app/lib/cc/sendImageDownload'

describe('send_image pinned HTTP transport', () => {
  it('connects to the validated DNS address with browser headers and origin Referer', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const destroy = vi.fn()
    mocks.request.mockImplementation((_url, _options, callback) => ({
      on: vi.fn(),
      end: () => callback({ statusCode: 200, headers: { 'content-type': 'image/png' }, destroy,
        [Symbol.asyncIterator]: async function* () { yield Buffer.from('picture') },
      }),
    }))
    await expect(downloadImage('https://example.com/tutorial/image.png')).resolves.toEqual(Buffer.from('picture'))
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith('example.com', { all: true })
    const [url, options] = mocks.request.mock.calls[0]
    expect(url.hostname).toBe('example.com')
    expect(options).toMatchObject({ family: 4, agent: false, headers: { Referer: 'https://example.com', 'User-Agent': expect.stringContaining('Mozilla/5.0') } })
    const callback = vi.fn()
    options.lookup('example.com', {}, callback)
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, '93.184.216.34', 4)
    expect(destroy).toHaveBeenCalledOnce()
  })
})
