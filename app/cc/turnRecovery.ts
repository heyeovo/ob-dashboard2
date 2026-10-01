import type { CcMessage } from './types'

/** Haven 同一 request 的正式消息替换本地占位，保持第一次渲染的 key。 */
export function mergeTurnMessages(previous: CcMessage[], incoming: CcMessage[]): CcMessage[] {
  const remaining = [...incoming]
  const merged = previous.map(message => {
    const index = remaining.findIndex(next => next.id === message.id || (
      next.requestId && next.requestId === message.requestId && next.role === message.role
    ))
    if (index < 0) return message
    const [next] = remaining.splice(index, 1)
    return { ...next, renderKey: message.renderKey || message.id }
  })
  return [...merged, ...remaining]
}
