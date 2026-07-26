'use client'
import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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

/**
 * 流式渲染中的一个已知取舍：markdown 是每帧重新解析的。
 * 半截的 ``` 或半截的 **，在补全前会短暂显示成原样文字，补全后自动变对。
 * 不做「等结束再渲染」——那样流式就没有意义了。
 */
function CcMarkdownInner({ text }: { text: string }) {
  return (
    <div className="cc-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(CcMarkdownInner)
