import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CcMessageRow from '@/app/cc/CcMessageRow'
import type { CcMessage, CcToolEvent } from '@/app/cc/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { downloadImage, isPublicImageAddress, pageImage, type DownloadDependencies, type DownloadResponse } from '@/app/lib/cc/sendImageDownload'
import { executeSendImage, sendImageMcpModelSurface } from '@/app/lib/cc/sendImageTool'
import { parseSentImage, SEND_IMAGE_TOOL } from '@/app/lib/cc/sendImageResult'
import { storedMcpResult } from '@/app/lib/cc/ccOptions'
import { shouldSaveMcpResult } from '@/app/lib/ccMcp'
import { builtInMcpPermissionForTool, builtInMcpServerNames } from '@/app/lib/cc/builtInMcp'

vi.mock('@/app/lib/havenAttachments', () => ({ uploadAttachment: vi.fn() }))
import { uploadAttachment } from '@/app/lib/havenAttachments'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function tempRoot() { const root = await mkdtemp(path.join(process.cwd(), '.send-image-test-')); roots.push(root); return root }
function response(data: string | Buffer, contentType = 'image/png', status = 200, location?: string): DownloadResponse {
  return { status, contentType, location, body: (async function* () { yield Buffer.from(data) })(), cancel: vi.fn() }
}
function deps(responses: DownloadResponse[]): DownloadDependencies {
  return { resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]), request: vi.fn(async () => responses.shift()!) }
}

describe('send_image download boundary', () => {
  it.each(['0.0.0.0', '0.1.2.3', '127.9.8.7', '10.1.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.1.1', '192.0.2.3', '198.18.1.1', '198.51.100.1', '203.0.113.2', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2001:db8::1', '2002:7f00:1::', '2001::1'])('rejects %s', address => {
    expect(isPublicImageAddress(address)).toBe(false)
  })
  it.each(['8.8.8.8', '172.32.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])('allows public %s', address => {
    expect(isPublicImageAddress(address)).toBe(true)
  })
  it('blocks literal hosts, unsupported schemes, mixed DNS and redirects into private hosts', async () => {
    const d = deps([response('', '', 302, 'http://127.0.0.1/private')])
    await expect(downloadImage('https://example.com', d)).rejects.toThrow('地址被拦截')
    expect(d.request).toHaveBeenCalledTimes(1)
    for (const url of ['file:///etc/passwd', 'http://[::1]', 'http://2130706433', 'http://0x7f000001', 'http://user:pass@example.com']) {
      await expect(downloadImage(url, deps([]))).rejects.toThrow('地址被拦截')
    }
    const mixed = deps([])
    mixed.resolve = async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]
    await expect(downloadImage('https://example.com', mixed)).rejects.toThrow('地址被拦截')
  })
  it('validates every redirect and limits redirects to three', async () => {
    const d = deps(Array.from({ length: 4 }, () => response('', '', 302, '/next')))
    await expect(downloadImage('https://example.com', d)).rejects.toThrow('重定向超过')
    expect(d.resolve).toHaveBeenCalledTimes(4)
    const safe = deps([response('', '', 302, '/next'), response('ok')])
    await expect(downloadImage('https://example.com', safe)).resolves.toEqual(Buffer.from('ok'))
    expect(safe.request).toHaveBeenLastCalledWith(new URL('https://example.com/next'), { address: '93.184.216.34', family: 4 }, expect.any(AbortSignal))
  })
  it('aborts an oversized response while reading, before the next chunk', async () => {
    const next = vi.fn()
    const res = response('')
    res.body = (async function* () { yield Buffer.alloc(10 * 1024 * 1024 + 1); next(); yield Buffer.from('never') })()
    await expect(downloadImage('https://example.com', deps([res]))).rejects.toThrow('10 MB')
    expect(next).not.toHaveBeenCalled()
    expect(res.cancel).toHaveBeenCalledOnce()
  })
  it('limits HTML to 2 MB and cancels the body', async () => {
    const res = response(Buffer.alloc(2 * 1024 * 1024 + 1), 'text/html')
    await expect(downloadImage('https://example.com', deps([res]))).rejects.toThrow('2 MB')
    expect(res.cancel).toHaveBeenCalledOnce()
  })
  it('uses relative og:image before twitter and image_src, revalidating the image URL', async () => {
    const html = `<link rel="image_src" href="/third"><meta name="twitter:image" content="/second"><meta content='../image.png?a=1&amp;b=2' property='og:image'>`
    const d = deps([response(html, 'text/html'), response('image')])
    await expect(downloadImage('https://example.com/tutorial/page', d)).resolves.toEqual(Buffer.from('image'))
    expect(d.request).toHaveBeenLastCalledWith(new URL('https://example.com/image.png?a=1&b=2'), expect.anything(), expect.anything())
    expect(pageImage('<meta name=twitter:image content=/second>', 'https://example.com')).toBe('https://example.com/second')
    expect(pageImage('<link href=/third rel=image_src>', 'https://example.com')).toBe('https://example.com/third')
    await expect(downloadImage('https://example.com', deps([response('<meta property="og:image" content="http://[::1]/a">', 'text/html')]))).rejects.toThrow('地址被拦截')
  })
  it('accepts decodable image bytes despite an HTML Content-Type', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
    await expect(downloadImage('https://example.com', deps([response(png, 'text/html')]))).resolves.toEqual(png)
  })
  it('reports no main image, including HTML without truthful Content-Type', async () => {
    await expect(downloadImage('https://example.com', deps([response('<!doctype html><html></html>', 'image/png')]))).rejects.toThrow('这个网页没找到主图')
  })
  it('times out DNS and stalled body reads after 15 seconds', async () => {
    vi.useFakeTimers()
    const d = deps([])
    d.resolve = () => new Promise(() => {})
    const pending = expect(downloadImage('https://example.com', d)).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    const res = response('')
    res.body = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }
    const stalled = expect(downloadImage('https://example.com', deps([res]))).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15_000)
    await stalled
    expect(res.cancel).toHaveBeenCalledOnce()
  })
})

describe('send_image tool and persistence', () => {
  it('is available in both modes with allow permission and version 1.0.0', () => {
    expect(builtInMcpServerNames({}, 'chat')).toContain('send_image')
    expect(builtInMcpServerNames({}, 'work')).toContain('send_image')
    expect(builtInMcpPermissionForTool(SEND_IMAGE_TOOL)).toBe('allow')
    expect(sendImageMcpModelSurface().version).toBe('1.0.0')
    expect(shouldSaveMcpResult(SEND_IMAGE_TOOL)).toBe(true)
  })
  it('requires exactly one source and limits caption', async () => {
    for (const input of [{}, { url: '', path: 'a.png' }, { url: 'https://example.com', path: 'a.png' }, { path: 'a.png', caption: '长'.repeat(201) }]) {
      expect(await executeSendImage(input, 'sid')).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('二选一') }] })
    }
  })
  it('rejects traversal, absolute paths and symlink escapes', async () => {
    const root = await tempRoot()
    await symlink(process.cwd(), path.join(root, 'link'))
    for (const file of ['../a.png', '/a.png', 'C:\\a.png', 'link/a.png']) {
      expect(await executeSendImage({ path: file }, 'sid', root)).toMatchObject({ isError: true })
    }
  })
  it('reports non-image bytes even with a valid extension', async () => {
    const root = await tempRoot()
    await writeFile(path.join(root, 'bad.png'), 'not a picture')
    expect(await executeSendImage({ path: 'bad.png' }, 'sid', root)).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('不是图片') }] })
    expect(uploadAttachment).not.toHaveBeenCalled()
  })
  it('rasterizes SVG, stores session WebP and returns thumbnail plus parseable text only in history', async () => {
    const root = await tempRoot()
    await writeFile(path.join(root, 'drawing.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="red"/></svg>')
    vi.mocked(uploadAttachment).mockResolvedValue({ ok: true, attachment: { id: 'att_123' } as never, error: '', status: 200 })
    const result = await executeSendImage({ path: 'drawing.svg', caption: '动作示意' }, 'current-session', root)
    expect(result).not.toHaveProperty('isError')
    expect(uploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'current-session', mimeType: 'image/webp', kind: 'image' }))
    const uploaded = vi.mocked(uploadAttachment).mock.calls.at(-1)![0]
    const metadata = await sharp(Buffer.from(uploaded.bytes)).metadata()
    expect([metadata.width, metadata.height]).toEqual([1200, 600])
    const thumbnail = result.content[0]
    expect(thumbnail.type).toBe('image')
    if (thumbnail.type !== 'image') throw new Error('thumbnail missing')
    expect((await sharp(Buffer.from(thumbnail.data, 'base64')).metadata()).width).toBe(512)
    for (const value of [result, result.content]) {
      const stored = storedMcpResult(value)
      expect(stored).not.toContain(thumbnail.data)
      expect(stored).not.toContain('base64')
      expect(parseSentImage(stored)).toMatchObject({ attachmentId: 'att_123', width: 1200, height: 600, caption: '动作示意' })
    }
  })
  it('never serializes image-only MCP results via JSON fallback', () => {
    const image = { type: 'image', data: 'BASE64_SECRET', mimeType: 'image/webp' }
    for (const value of [[image], { content: [image] }, image, { output: [image] }, { content: [image, { type: 'text', text: 'safe' }] }]) {
      expect(storedMcpResult(value)).not.toContain('BASE64_SECRET')
    }
    expect(storedMcpResult([{ type: 'text', text: 'safe' }, image])).toBe('safe')
    expect(parseSentImage('unrelated [attachment:id]')).toBeNull()
  })
})


describe('inline sent image presentation', () => {
  const tool: CcToolEvent = { id: 'sent', name: SEND_IMAGE_TOOL, input: {}, status: 'completed', result: '已发送图片 [attachment:att_123] 1200×600\nhttps://example.com/image.png\n动作示意\n看一眼缩略图，不对就在回复里说明，别假装是对的' }
  function render(overrides: Partial<CcMessage>) {
    return renderToStaticMarkup(createElement(CcMessageRow, { sessionId: 'current-session', message: { id: 'message', role: 'assistant', text: '', createdAt: 1, ...overrides }, isCurrentTurn: false, onCopy: () => {} }))
  }
  it('renders completed results outside the closed Tools for stream and history', () => {
    for (const streaming of [true, false]) {
      const html = render({ streaming, fromHistory: !streaming, process: [{ type: 'tool', id: 'sent', tool }] })
      expect(html).toContain('/api/cc-attachments/att_123?session_id=current-session')
      expect(html).toContain('<figcaption')
      expect(html).toContain('动作示意')
      expect(html).toContain('target="_blank"')
      expect(html).toContain('loading="lazy"')
    }
    expect(render({ tools: [tool] })).toContain('/api/cc-attachments/att_123')
  })
  it('does not show running, failed or private room images', () => {
    for (const status of ['running', 'error'] as const) {
      expect(render({ tools: [{ ...tool, status }] })).not.toContain('/api/cc-attachments/')
    }
    // Private calls are nested in a room visit, never in the public tools/process list.
    expect(render({ process: [{ type: 'room', id: 'visit', roomId: 'room_abc', roomTitle: '', enteredAt: 1, process: [{ type: 'tool', id: 'sent', tool }] } as never] })).not.toContain('/api/cc-attachments/')
  })
})
