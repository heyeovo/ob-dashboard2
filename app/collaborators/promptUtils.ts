import { estimateTextTokens } from '@/app/lib/recallDisplay'

export function promptSize(text: string): string {
  const tokens = estimateTextTokens(text)
  const short = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  return `${text.length.toLocaleString('zh-CN')} 字 · 约 ${short} token`
}
