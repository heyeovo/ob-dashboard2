// 一轮对话的「过程收集器」：thinking / 助手文字 / 工具按实际发生顺序
// 攒进这一轮的 process 数组（第 7 步建，9.5 从 route.ts 原样抽出）。
//
// ⚠️ 为什么桶要放在模块级 Map 而不是跟着 runTurn 的局部变量走：
// hooks 的闭包只在会话**第一轮**建起来（ccSession 里已有会话就复用），
// 要拿到第 N 轮的 process / webSearchCount 就得每轮按 sessionId 重查。
// 这也意味着：一轮结束必须 delete 掉自己的桶，不然下一轮会跟旧数据叠一起。
//
// 收集器只负责「攒」，不负责「展示」—— 攒出来的数组写进 raw_json.process，
// 前端历史读回后按原顺序展示。

import { emit } from '@/app/lib/ccChannel'

/** 这一轮的收集口。hook 和 canUseTool 都从桶里拿，不捕获局部变量。 */
export type TurnBucket = {
  recallInfo: Record<string, unknown> | null
  toolEvents: Array<Record<string, unknown>>
  processEvents: Array<Record<string, unknown>>
  webSearchCount: number
  webFetchCount: number
}

export function newTurnBucket(): TurnBucket {
  return {
    recallInfo: null,
    toolEvents: [],
    processEvents: [],
    webSearchCount: 0,
    webFetchCount: 0,
  }
}

/** 这个会话「当前那一轮」的桶。 */
const turnBuckets = new Map<string, TurnBucket>()

export function setTurnBucket(sessionId: string, bucket: TurnBucket) {
  turnBuckets.set(sessionId, bucket)
}

export function getTurnBucket(sessionId: string): TurnBucket | null {
  return turnBuckets.get(sessionId) || null
}

/** 只删自己那份：收尾这一秒里可能已经有新的一轮把它换掉了 */
export function deleteTurnBucket(sessionId: string, bucket: TurnBucket) {
  if (turnBuckets.get(sessionId) === bucket) turnBuckets.delete(sessionId)
}

/** 会话被收掉时无条件清掉残留桶（DELETE 路由用；正常收尾走 deleteTurnBucket）。 */
export function clearTurnBucket(sessionId: string) {
  turnBuckets.delete(sessionId)
}

/** 工具记录加一条，同时推给前端。hook 里必须用这个，不能碰局部变量。 */
export function pushToolEvent(sessionId: string, item: Record<string, unknown>) {
  const bucket = turnBuckets.get(sessionId)
  if (bucket) {
    closeThinkingProcess(bucket, Date.now())
    bucket.toolEvents.push(item)
    bucket.processEvents.push({
      type: 'tool',
      id: `process-${String(item.id || Date.now())}`,
      tool: item,
    })
  }
  emit(sessionId, 'tool', item)
}

export function closeThinkingProcess(bucket: TurnBucket, endedAt: number) {
  const last = bucket.processEvents.at(-1)
  if (!last || last.type !== 'thinking' || typeof last.durationMs === 'number') return
  last.durationMs = Math.max(0, endedAt - Number(last.startedAt || endedAt))
}

export function appendThinkingProcess(
  bucket: TurnBucket,
  text: string,
): { id: string; startedAt: number } {
  const last = bucket.processEvents.at(-1)
  if (last?.type === 'thinking' && typeof last.durationMs !== 'number') {
    last.text = String(last.text || '') + text
    return {
      id: String(last.id),
      startedAt: Number(last.startedAt || Date.now()),
    }
  }

  const startedAt = Date.now()
  const item = {
    type: 'thinking',
    id: `thinking-${startedAt}-${bucket.processEvents.length}`,
    text,
    startedAt,
  }
  bucket.processEvents.push(item)
  return { id: item.id, startedAt }
}

export function appendTextProcess(bucket: TurnBucket, text: string): { id: string } {
  const last = bucket.processEvents.at(-1)
  if (last?.type === 'text') {
    last.text = String(last.text || '') + text
    return { id: String(last.id) }
  }

  const item = {
    type: 'text',
    id: `text-${Date.now()}-${bucket.processEvents.length}`,
    text,
  }
  bucket.processEvents.push(item)
  return { id: item.id }
}
