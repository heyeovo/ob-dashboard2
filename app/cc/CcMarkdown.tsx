'use client'
import { Children, cloneElement, isValidElement, memo, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'

// 助手回复的 markdown 渲染。
//
// ⚠️ 排版全部靠 globals.css 尾部的 .cc-md 段（一处改全站聊天页生效），
// 这里只做结构和代码块的交互，不写行内样式。
// ⚠️ 没上语法高亮：那要多一个包 + 一套配色，先按纯文本 + 等宽字体走。
// 用户输入不走这里（用户说的话不该被当 markdown 解析）。

function collectText(node: unknown): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props
    return collectText(props?.children)
  }
  return ''
}

/** ```lang 里的语言名。拿不到就不显示。 */
function langOf(node: unknown): string {
  if (node == null || typeof node !== 'object') return ''
  const props = (node as { props?: { className?: unknown; children?: unknown } }).props
  const cls = typeof props?.className === 'string' ? props.className : ''
  const hit = /language-([\w+#-]+)/.exec(cls)
  if (hit) return hit[1]
  return Array.isArray(props?.children) ? langOf(props.children[0]) : ''
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const text = collectText(children)
  const lang = langOf(Array.isArray(children) ? children[0] : children)

  const copy = () => {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="cc-md-codewrap">
      <div className="cc-md-codebar">
        <span className="cc-md-codelang">{lang || 'code'}</span>
        <button type="button" onClick={copy} className="cc-md-codecopy">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="cc-md-pre">{children}</pre>
    </div>
  )
}

const COMPONENTS: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="cc-md-link">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="cc-md-tablewrap">
      <table>{children}</table>
    </div>
  ),
}

export function highlightSearchText(text: string, query: string, active = false): ReactNode {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return text
  const haystack = text.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let match = haystack.indexOf(needle)
  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match))
    parts.push(
      <mark
        key={`${match}-${parts.length}`}
        className={`rounded-sm px-0.5 text-inherit ${active ? 'bg-amber-300' : 'bg-amber-100'}`}
      >
        {text.slice(match, match + needle.length)}
      </mark>,
    )
    cursor = match + needle.length
    match = haystack.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function highlightSearchNode(node: ReactNode, query: string, active: boolean): ReactNode {
  if (typeof node === 'string') return highlightSearchText(node, query, active)
  if (Array.isArray(node)) return Children.map(node, child => highlightSearchNode(child, query, active))
  if (!isValidElement(node)) return node
  if (node.type === 'code' || node.type === 'pre') return node
  const element = node as ReactElement<{ children?: ReactNode }>
  return cloneElement(element, undefined, highlightSearchNode(element.props.children, query, active))
}

function highlightedComponents(query: string, active: boolean): Components {
  const highlight = (children: ReactNode) => highlightSearchNode(children, query, active)
  return {
    ...COMPONENTS,
    p: ({ children }) => <p>{highlight(children)}</p>,
    li: ({ children }) => <li>{highlight(children)}</li>,
    h1: ({ children }) => <h1>{highlight(children)}</h1>,
    h2: ({ children }) => <h2>{highlight(children)}</h2>,
    h3: ({ children }) => <h3>{highlight(children)}</h3>,
    h4: ({ children }) => <h4>{highlight(children)}</h4>,
    h5: ({ children }) => <h5>{highlight(children)}</h5>,
    h6: ({ children }) => <h6>{highlight(children)}</h6>,
    td: ({ children }) => <td>{highlight(children)}</td>,
    th: ({ children }) => <th>{highlight(children)}</th>,
    blockquote: ({ children }) => <blockquote>{highlight(children)}</blockquote>,
  }
}

/**
 * 流式渲染中的一个已知取舍：markdown 是每帧重新解析的。
 * 半截的 ``` 或半截的 **，在补全前会短暂显示成原样文字，补全后自动变对。
 * 不做「等结束再渲染」——那样流式就没有意义了。
 */
function CcMarkdownInner({
  text,
  searchQuery = '',
  searchActive = false,
}: {
  text: string
  searchQuery?: string
  searchActive?: boolean
}) {
  const components = useMemo(
    () => searchQuery.trim() ? highlightedComponents(searchQuery, searchActive) : COMPONENTS,
    [searchActive, searchQuery],
  )
  return (
    <div className="cc-md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(CcMarkdownInner)
