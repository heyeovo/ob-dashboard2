import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

export const DISPLAY_SEGMENTS_VERSION = 1

export type DisplaySegment = {
  kind: 'text' | 'atomic'
  markdown: string
}

export type VersionedDisplaySegments = {
  version: typeof DISPLAY_SEGMENTS_VERSION
  segments: DisplaySegment[]
}

type PositionedNode = {
  type?: string
  position?: { start?: { offset?: number }; end?: { offset?: number } }
}

const ATOMIC_BLOCKS = new Set(['code', 'html', 'list', 'table', 'blockquote', 'thematicBreak', 'definition'])

function offset(node: PositionedNode, edge: 'start' | 'end'): number | null {
  const value = node.position?.[edge]?.offset
  return typeof value === 'number' ? value : null
}

function splitParagraph(markdown: string, contentEnd: number): DisplaySegment[] {
  const content = markdown.slice(0, contentEnd)
  const trailing = markdown.slice(contentEnd)
  const lines = content.split(/(?<=\n)/)
  if (lines.length <= 1) return [{ kind: 'text', markdown }]
  return lines
    .filter(Boolean)
    .map((line, index) => ({
      kind: 'text' as const,
      markdown: line + (index === lines.length - 1 ? trailing : ''),
    }))
}

/**
 * Build presentation-only segments without changing the persisted assistant text.
 * Joining every segment's markdown always reproduces the original string exactly.
 */
export function buildDisplaySegments(text: string): VersionedDisplaySegments {
  if (!text) return { version: DISPLAY_SEGMENTS_VERSION, segments: [] }
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as { children?: PositionedNode[] }
  const nodes = Array.isArray(tree.children) ? tree.children : []
  if (nodes.length === 0) {
    return { version: DISPLAY_SEGMENTS_VERSION, segments: [{ kind: 'text', markdown: text }] }
  }

  const segments: DisplaySegment[] = []
  let index = 0
  while (index < nodes.length) {
    const node = nodes[index]
    const start = index === 0 ? 0 : offset(node, 'start') ?? 0
    let lastIndex = index
    let kind: DisplaySegment['kind'] = ATOMIC_BLOCKS.has(String(node.type)) ? 'atomic' : 'text'

    // A heading and its immediately following block remain one presentation unit.
    if (node.type === 'heading') {
      kind = 'atomic'
      if (index + 1 < nodes.length && nodes[index + 1]?.type !== 'heading') lastIndex = index + 1
    }

    const next = nodes[lastIndex + 1]
    const end = next ? (offset(next, 'start') ?? text.length) : text.length
    const markdown = text.slice(start, end)
    if (node.type === 'paragraph' && lastIndex === index) {
      const paragraphEnd = Math.max(0, (offset(node, 'end') ?? end) - start)
      segments.push(...splitParagraph(markdown, paragraphEnd))
    } else if (markdown) {
      segments.push({ kind, markdown })
    }
    index = lastIndex + 1
  }

  return { version: DISPLAY_SEGMENTS_VERSION, segments }
}

export function normalizeDisplaySegments(value: unknown): VersionedDisplaySegments | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { version?: unknown; segments?: unknown }
  if (raw.version !== DISPLAY_SEGMENTS_VERSION || !Array.isArray(raw.segments)) return null
  const segments = raw.segments.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const segment = item as Record<string, unknown>
    if (typeof segment.markdown !== 'string') return []
    return [{
      kind: segment.kind === 'atomic' ? 'atomic' as const : 'text' as const,
      markdown: segment.markdown,
    }]
  })
  return { version: DISPLAY_SEGMENTS_VERSION, segments }
}
