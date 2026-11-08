import sharp from 'sharp'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const MAX_BYTES = 10 * 1024 * 1024
const HTML_BYTES = 2 * 1024 * 1024

/** Only public unicast destinations; also reject mapped IPv4 and transition networks. */
export function isPublicImageAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6) return false
  const [left, right] = address.toLowerCase().split('::')
  const l = left ? left.split(':') : []
  const r = right ? right.split(':') : []
  const groups = right === undefined ? l : [...l, ...Array(8 - l.length - r.length).fill('0'), ...r]
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return false
  const n = groups.map(g => parseInt(g, 16))
  return n[0] >= 0x2000 && n[0] <= 0x3fff &&
    n[0] !== 0x2002 && !(n[0] === 0x2001 && (n[1] <= 0x1ff || n[1] === 0xdb8)) &&
    !(n[0] === 0x3fff && n[1] <= 0xfff)
}

export type DownloadResponse = {
  status: number
  location?: string
  contentType?: string
  body: AsyncIterable<Uint8Array>
  cancel: () => void
}
export type DownloadDependencies = {
  resolve: (host: string) => Promise<Array<{ address: string; family: number }>>
  request: (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<DownloadResponse>
}
const dependencies: DownloadDependencies = {
  resolve: host => lookup(host, { all: true }),
  request: (url, address, signal) => new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal,
      agent: false,
      family: address.family,
      // Pin the validated address; TLS still verifies the original hostname.
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Referer: url.origin, 'Accept-Encoding': 'identity' },
    }, res => resolve({
      status: res.statusCode || 0,
      location: res.headers.location,
      contentType: res.headers['content-type'],
      body: res,
      cancel: () => res.destroy(),
    }))
    req.on('error', reject)
    req.end()
  }),
}

function decodeAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
    const n = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
  })
}
export function pageImage(html: string, pageUrl: string): string | null {
  const tags = [...html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').matchAll(/<(meta|link)\b[^>]*>/gi)]
  const candidates = tags.map(tag => {
    const attrs: Record<string, string> = {}
    for (const a of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1].toLowerCase()] = decodeAttribute(a[2] ?? a[3] ?? a[4])
    return { tag: tag[1].toLowerCase(), attrs }
  })
  for (const key of ['og:image', 'twitter:image', 'image_src']) {
    const match = candidates.find(({ tag, attrs }) => key === 'image_src'
      ? tag === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes(key) && attrs.href
      : tag === 'meta' && (attrs.property || attrs.name)?.toLowerCase() === key && attrs.content)
    if (match) return new URL(match.attrs.content || match.attrs.href, pageUrl).href
  }
  return null
}

export async function downloadImage(source: string, deps = dependencies): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const signal = controller.signal
  // Race DNS and mock transports too, so the deadline covers the whole download.
  async function within<T>(promise: Promise<T>): Promise<T> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('下载超时（15 秒）'))
      signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  async function get(raw: string, allowHtml: boolean): Promise<Buffer> {
    let url = new URL(raw)
    for (let redirects = 0; ; redirects++) {
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('地址被拦截：只允许 http/https 公网地址')
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await within(deps.resolve(host))
      if (!addresses.length || addresses.some(a => !isPublicImageAddress(a.address))) throw new Error('地址被拦截：内网、本机或保留地址')
      const response = await within(deps.request(url, addresses[0], signal))
      try {
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location || redirects >= 3) throw new Error('重定向超过 3 次或地址无效')
          url = new URL(response.location, url)
          continue
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`图片下载失败（HTTP ${response.status}）`)
        let size = 0
        let html = /(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType || '')
        const chunks: Buffer[] = []
        let prefix = Buffer.alloc(0)
        const iterator = response.body[Symbol.asyncIterator]()
        for (;;) {
          const item = await within(iterator.next())
          if (item.done) break
          const chunk = Buffer.from(item.value)
          size += chunk.length
          chunks.push(chunk)
          if (prefix.length < 256) prefix = Buffer.concat([prefix, chunk.subarray(0, 256 - prefix.length)])
          if (!html) html = /^\s*(?:<!doctype\s+html|<html|<head|<meta)\b/i.test(prefix.toString('utf8'))
          if (size > (html ? HTML_BYTES : MAX_BYTES)) throw new Error(html ? '网页太大（超过 2 MB）' : '图片太大（超过 10 MB）')
        }
        const bytes = Buffer.concat(chunks)
        if (!html) return bytes
        // A mislabeled image is still an image; the decoder is authoritative.
        try {
          await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
          return bytes
        } catch { /* Actual HTML falls through to main-image extraction. */ }
        const image = allowHtml ? pageImage(bytes.toString('utf8'), url.href) : null
        if (!image) throw new Error('这个网页没找到主图，换一个直接的图片地址')
        return await get(image, false)
      } finally { response.cancel() }
    }
  }
  try { return await get(source, true) }
  catch (error) {
    if (signal.aborted) throw new Error('下载超时（15 秒）')
    throw error
  } finally { clearTimeout(timer) }
}
