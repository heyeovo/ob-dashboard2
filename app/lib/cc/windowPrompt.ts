import { dailyReviewSystemBlock, type HavenConversationSession } from '@/app/lib/havenTurns'
import { handoffSnapshotContent } from '@/app/lib/cc/handoffSnapshot'
import { sessionStaticContext } from '@/app/lib/runtimeContext'

type FixedWindowSource = Pick<
  HavenConversationSession,
  'handoff_snapshot' | 'daily_review_enabled' | 'daily_review_snapshot'
>

/**
 * 新窗口的固定背景统一来自 handoff。旧日回顾字段只兼容尚无 handoff 的历史窗口，
 * 两条路径永远不同时注入。
 */
export function fixedWindowAppend(session: FixedWindowSource): string {
  const handoff = handoffSnapshotContent(session.handoff_snapshot)
  if (handoff) return handoff
  return session.daily_review_enabled
    ? dailyReviewSystemBlock(session.daily_review_snapshot)
    : ''
}

/** 每轮都用最新协作者配置重组；只有 fixedWindowAppend 的来源内容按窗口冻结。 */
export function composeWindowPersonaAppend(
  dynamicPersonaAppend: string,
  session: FixedWindowSource,
  sessionId: string,
): string {
  return [
    dynamicPersonaAppend,
    fixedWindowAppend(session),
    sessionStaticContext(sessionId),
  ].filter(Boolean).join('\n\n')
}
