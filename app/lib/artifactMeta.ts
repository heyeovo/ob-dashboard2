// artifacts 的纯函数部分：前端卡片和服务端路由共用，不碰 fs / SDK。

/** 言之做的可交互页面放在 yanzhi's files 的这个子目录，由 /api/artifacts 托管。 */
export const ARTIFACTS_DIR = 'artifacts'

export type ArtifactKind = 'html' | 'svg'

const NAME_RE = /^[\w一-鿿][\w一-鿿.-]{0,120}\.(html|svg)$/i
const HEAD_CHARS = 16 * 1024

export function isArtifactName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..')
}

export function artifactKind(name: string): ArtifactKind {
  return name.toLowerCase().endsWith('.svg') ? 'svg' : 'html'
}

export function artifactBaseName(name: string): string {
  return name.replace(/\.(html|svg)$/i, '')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseArtifactHead(text: string): { title: string; description: string } {
  const head = text.slice(0, HEAD_CHARS)
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? ''
  const meta = /<meta\s[^>]*name\s*=\s*["']?description["']?[^>]*>/i.exec(head)?.[0] ?? ''
  const description = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(meta)
  return {
    title: decodeEntities(title.replace(/\s+/g, ' ').trim()).slice(0, 80),
    description: decodeEntities((description?.[1] ?? description?.[2] ?? '').replace(/\s+/g, ' ').trim()).slice(0, 200),
  }
}

/**
 * 这次工具调用是不是在写 / 改一个 artifact。是的话返回文件名，
 * 聊天里据此出卡片；工具本身会校验路径，这里只做识别。
 */
export function artifactFromToolCall(name: string, input: unknown): { name: string; action: 'write' | 'patch'; title: string } | null {
  if (name !== 'mcp__yanzhi__files') return null
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const action = record.action
  if (action !== 'write' && action !== 'patch') return null
  const raw = String(record.path || '').trim().replace(/^\.?\/+/, '')
  const prefix = `${ARTIFACTS_DIR}/`
  if (!raw.startsWith(prefix)) return null
  const file = raw.slice(prefix.length)
  if (!isArtifactName(file)) return null
  const title = typeof record.title === 'string'
    ? record.title
    : action === 'write' && typeof record.content === 'string'
      ? parseArtifactHead(record.content).title
      : ''
  return { name: file, action, title }
}

/**
 * 存进消息记录的工具 input：artifact 整页 content 换成标题 + 字数。
 * 页面已经落盘，聊天历史和 Haven 里不必再带一份整页代码；其他调用原样返回。
 */
export function slimToolInputForStorage(name: string, input: unknown): unknown {
  const artifact = artifactFromToolCall(name, input)
  if (!artifact || artifact.action !== 'write') return input
  const { content, ...rest } = input as Record<string, unknown>
  return { ...rest, title: artifact.title, content_chars: typeof content === 'string' ? content.length : 0 }
}
