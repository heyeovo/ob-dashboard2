import { NextRequest } from 'next/server'
import { markTurnInterrupted, stopSession } from '@/app/lib/ccSession'
import { cancelAllPending } from '@/app/lib/ccChannel'

export const runtime = 'nodejs'

/**
 * 点「停止」时调。让当前这一轮优雅收尾，而不是像以前那样断开 SSE、把半截回复整个丢掉。
 *
 * 三件事：
 *   1. 标记这一轮被中断 —— cc-chat 的 POST 循环读到后不当错误处理，保留已生成的字写库
 *   2. 调 q.interrupt() 把模型叫停 —— 不杀子进程，会话上下文保留，下一句能接上
 *   3. 清掉这一轮挂着等批准的操作 —— 轮子已经停了，卡片留着只会骗人
 *
 * 前端点停止后 SSE 连接保持不关，所以这一步做完，POST 循环那边还会继续把
 * 收尾事件（done / after）推回浏览器。
 */
export async function POST(request: NextRequest) {
  let sessionId = ''
  try {
    const body = (await request.json()) as { session_id?: string }
    sessionId = String(body?.session_id || '').trim()
  } catch {
    /* 下面统一判空 */
  }
  if (!sessionId) return Response.json({ ok: false, error: 'session_id 为空' }, { status: 400 })

  markTurnInterrupted(sessionId)
  await stopSession(sessionId)
  cancelAllPending(sessionId, '你按了停止，这一轮到此为止，挂着的操作取消了。')
  return Response.json({ ok: true })
}
