import type { CcMessage, CcToolEvent, GptEventMap, GptRequest, GptError } from './types'
import { consumeSseStream, type SseHandlers } from './ccSseConsumer'
import { turnsToMessages, type HavenTurnRow } from './ccHistory'
import { mergeTurnMessages } from './turnRecovery'
import { gptErrorNote, gptOutcomeNote, normalizeGptUsage, normalizeGptContext, normalizeGptElapsed } from './gptPresentation'
import { buildStableDisplaySegments } from '@/app/lib/cc/displaySegments'

type Update = (apply: (messages: CcMessage[]) => CcMessage[]) => void

export function ensureGptMessages(messages: CcMessage[], request: Pick<GptRequest, 'request_id' | 'text'>,
  at: number, original?: GptRequest): CcMessage[] {
  const incoming: CcMessage[] = []
  for (const role of ['user', 'assistant'] as const) {
    if (messages.some(message => message.requestId === request.request_id && message.role === role)) continue
    incoming.push({ id: `gpt-${request.request_id}-${role}`, requestId: request.request_id, role,
      text: role === 'user' ? request.text : '', createdAt: at, engine: 'gpt_subscription',
      ...(role === 'assistant' ? { deliveryState: 'detached' as const, gptRetryRequest: original } : {}) })
  }
  return [...messages, ...incoming]
}

/** Both the durable JSON snapshot and the live stream replace the same request in place. */
export async function consumeGptResponse(response: Response, options: {
  requestId: string; update: Update; after: number; received: (sequence: number) => void
  saved: (roundId: number) => void
  attention?: (error: GptError) => void
  refreshPermissions?: () => void
}): Promise<'pending' | 'settled'> {
  const { requestId, update } = options
  const patch = (apply: (message: CcMessage) => CcMessage) => update(messages => messages.map(message =>
    message.requestId === requestId && message.role === 'assistant' ? apply(message) : message))
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json()
    if (response.ok && data.status === 'saved' && data.turn) {
      const turn = data.turn as HavenTurnRow
      if (turn.request_id !== requestId || turn.source !== 'gpt_subscription') throw new Error('保存记录与当前 GPT 请求不匹配')
      update(messages => mergeTurnMessages(messages, turnsToMessages([turn])))
      options.saved(Number(turn.round_id || 0))
      return 'settled'
    }
    if (response.ok && data.status === 'running') {
      patch(message => ({ ...message, streaming: false, deliveryState: 'detached',
        deliveryNote: '服务器仍在处理，稍后自动核对保存结果。' }))
      return 'pending'
    }
    const error = data.error && typeof data.error === 'object' ? data.error : data
    const bufferLost = error.code === 'stream_buffer_lost' || error.code === 'stream_cursor_invalid'
    patch(message => ({ ...message, streaming: false,
      deliveryState: bufferLost ? 'detached' : 'persistence_unknown',
      deliveryNote: bufferLost ? '实时连接不可恢复，正在核对 Haven 历史。'
        : data.status ? '暂未找到已保存回复。请核对保存状态；不会自动重新生成。如原草稿已丢失，请核对历史后新建窗口继续。'
        : gptErrorNote(error) || '无法核对保存结果，请稍后重试。' }))
    return bufferLost ? 'pending' : 'settled'
  }
  if (!response.ok || !response.body) throw new Error(`连接失败（${response.status}）`)
  if (options.after === 0) patch(message => ({ ...message, text: '', process: [], displaySegments: [],
    tools: [], streaming: true, deliveryState: 'generating', deliveryNote: undefined }))
  const noop = () => {}
  const handlers: SseHandlers = {
    onStart: noop, onContext: value => patch(message => ({ ...message, gptContext: normalizeGptContext(value) })),
    onContextSnapshot: noop, onCompact: noop, onCompactStatus: noop,
    onThinking: noop, onPermission: () => options.refreshPermissions?.(),
    onPermissionResolved: () => options.refreshPermissions?.(), onAfter: noop,
    onTool: value => {
      const tool = value as unknown as CcToolEvent
      patch(message => message.tools?.some(item => item.id === tool.id) ? message : ({
        ...message, tools: [...(message.tools || []), tool],
        process: [...(message.process || []), { type: 'tool', id: `process-${tool.id}`, tool }],
      }))
    },
    onToolResult: value => {
      const { id, status, result, error, durationMs } = value as GptEventMap['tool_result']
      const finishTool = (tool: CcToolEvent) => tool.id === id ? { ...tool, status, result, error, durationMs } : tool
      patch(message => ({ ...message, tools: message.tools?.map(finishTool),
        process: message.process?.map(event => event.type === 'tool' ? { ...event, tool: finishTool(event.tool) } : event) }))
    },
    onInit: value => { const data = value as GptEventMap['init']; patch(message => ({ ...message, model: data.model })) },
    onDelta: value => { const data = value as GptEventMap['delta']; patch(message => {
      const text = message.text + data.text
      const process = [...(message.process || [])]
      const last = process.at(-1)
      if (last?.type === 'text') process[process.length - 1] = { ...last, text: last.text + data.text }
      else process.push({ type: 'text', id: `text-${process.length}`, text: data.text })
      return { ...message, text, process, streaming: true, displaySegments: buildStableDisplaySegments(text, false).segments }
    }) },
    onRecall: value => patch(message => ({ ...message, recall: value as unknown as CcMessage['recall'] })),
    onUsage: value => patch(message => ({ ...message, gptUsage: normalizeGptUsage(value.usage) })),
    onError: value => { const error = value as GptEventMap['error']; options.attention?.(error); patch(message => ({ ...message,
      streaming: false, deliveryState: error.persistence_unknown ? 'persistence_unknown' : 'not_saved',
      deliveryNote: gptErrorNote(error), interrupted: true,
      displaySegments: buildStableDisplaySegments(message.text, true).segments })) },
    onDone: value => {
      const data = value as GptEventMap['done']
      if (data.request_id !== requestId) throw new Error('GPT 完成事件与当前请求不匹配')
      update(messages => messages.map(message => message.requestId !== requestId ? message : {
        ...message, renderKey: message.renderKey || message.id,
        id: message.role === 'user' ? data.user_message_id : data.assistant_message_id,
        roundId: data.round_id,
        ...(message.role === 'assistant' ? { streaming: false, engine: 'gpt_subscription' as const,
          model: data.model, gptUsage: normalizeGptUsage(data.usage), gptOutcome: data.outcome,
          gptElapsedMs: normalizeGptElapsed(data.elapsed_ms),
          interrupted: data.outcome !== 'completed', gptRetryRequest: undefined,
          deliveryState: 'saved' as const,
          deliveryNote: data.outcome === 'failed' && message.deliveryNote
            ? `${message.deliveryNote} ${gptOutcomeNote(data.outcome)}` : gptOutcomeNote(data.outcome),
          displaySegments: buildStableDisplaySegments(message.text, true).segments } : {}),
      }))
      options.saved(data.round_id)
    },
  }
  await consumeSseStream(response.body, handlers, { after: options.after, received: options.received })
  return 'settled'
}
