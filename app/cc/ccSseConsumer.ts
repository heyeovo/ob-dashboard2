// /cc 聊天页的 SSE 流消费（9.5 从 useCcChat 的 send 原样抽出）。
//
// 原来 send() 里 fetch + 帧解析 + 事件分发揉在一起，这层把它拆成：
//   消费循环（读流 → 切帧 → 按事件名分发）在这里，
//   「每个事件怎么影响界面状态」由调用方（useCcChat）提供 handlers。
// 第 10 步自建引擎的请求走同一套事件契约（见 lib/cc/sseEvents.ts），
// 换引擎时这个消费者可以直接复用。

import { takeSseFrame } from '@/app/lib/cc/sseEvents'
import type { CcPermRequest } from '@/app/cc/types'

export type SseEventPayload = Record<string, unknown>

export type SseHandlers = {
  onStart: (data: SseEventPayload) => void
  onContext: (data: SseEventPayload) => void
  onInit: (data: SseEventPayload) => void
  onDelta: (data: SseEventPayload) => void
  onThinking: (data: SseEventPayload) => void
  onUsage: (data: SseEventPayload) => void
  onRecall: (data: SseEventPayload) => void
  onTool: (data: SseEventPayload) => void
  onToolResult: (data: SseEventPayload) => void
  onPermission: (data: SseEventPayload) => void
  onPermissionResolved: (data: SseEventPayload) => void
  /** 返回 true = 这一轮正常收尾 */
  onDone: (data: SseEventPayload) => void
  onAfter: (data: SseEventPayload) => void
  onError: (data: SseEventPayload) => void
}

export type SseTerminal = 'done' | 'error' | null

/**
 * 消费一个 SSE 响应体，直到流结束。
 *
 * @returns 最后一个终态事件（done / error）。流正常结束但没收到终态 → 抛错
 *（调用方按「连接提前结束」处理）。
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
): Promise<SseTerminal> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal: SseTerminal = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以空行分帧
    let frameResult = takeSseFrame(buffer)
    while (frameResult.frame) {
      buffer = frameResult.rest
      const { event, data } = frameResult.frame

      if (event === 'start') handlers.onStart(data)
      else if (event === 'context') handlers.onContext(data)
      else if (event === 'init') handlers.onInit(data)
      else if (event === 'delta') handlers.onDelta(data)
      else if (event === 'thinking') handlers.onThinking(data)
      else if (event === 'usage') handlers.onUsage(data)
      else if (event === 'recall') handlers.onRecall(data)
      else if (event === 'tool') handlers.onTool(data)
      else if (event === 'tool_result') handlers.onToolResult(data)
      else if (event === 'permission') handlers.onPermission(data)
      else if (event === 'permission_resolved') handlers.onPermissionResolved(data)
      else if (event === 'done') {
        terminal = 'done'
        handlers.onDone(data)
      } else if (event === 'after') handlers.onAfter(data)
      else if (event === 'error') {
        terminal = 'error'
        handlers.onError(data)
      }
      // 其它事件（files / command 等）前端不消费，忽略

      frameResult = takeSseFrame(buffer)
    }
  }

  if (!terminal) throw new Error('连接提前结束，没有收到这一轮的完成结果')
  return terminal
}

export type { CcPermRequest }
