import type { GptUsage, GptError, GptDone } from './types'

export function normalizeGptUsage(value: unknown): GptUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const number = (key: keyof GptUsage) => typeof raw[key] === 'number'
    && Number.isFinite(raw[key]) && Number(raw[key]) >= 0 ? Number(raw[key]) : null
  return { input_tokens: number('input_tokens'), output_tokens: number('output_tokens'),
    total_tokens: number('total_tokens'), cached_tokens: number('cached_tokens'), reasoning_tokens: number('reasoning_tokens') }
}

export function gptOutcomeNote(outcome: GptDone['outcome']): string {
  return outcome === 'completed' ? '已保存到 Haven'
    : outcome === 'cancelled' ? '已停止；部分回复已保存到 Haven' : '回复中断；已有内容已保存到 Haven'
}

export function gptErrorNote(error: Pick<GptError, 'message' | 'action'>): string {
  const action = error.action === 'reconnect' ? '请在电脑管理工具重新授权，再通过 SSH 交接。'
    : error.action === 'usage_settings' ? '请到 ChatGPT 设置查看共享额度；剩余额度和重置时间未知。'
    : error.action === 'enable_sharing' ? '请到 ChatGPT 设置开启共享授权。'
    : error.action === 'inspect' ? '请检查服务器配置并保留原授权文件。' : ''
  return [error.message, action].filter(Boolean).join(' ')
}
