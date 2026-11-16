import { listTurns, type HavenConversationSession } from '../havenTurns'
import { gptGateway, actualUsage } from './transport'
import type { GptAuditData, GptAuditRecord, GptAuditTurn } from './auditTypes'
import { sortGptAuditTurns } from './auditTypes'

export async function readGptAudit(sessionId: string, session: HavenConversationSession, params: URLSearchParams): Promise<GptAuditData> {
  const beforeCursor = params.get('before_cursor')
  const beforeTurn = params.get('before_turn_id')
  for (const value of [beforeCursor, beforeTurn]) {
    if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error('无效的审计分页位置')
  }
  const history = beforeTurn === '0' ? { ok: true, turns: [], error: '' } : await listTurns(sessionId, { source: 'gpt_subscription', limit: 20,
    includeRaw: true, ...(beforeTurn ? { beforeId: Number(beforeTurn) } : {}) })
  if (!history.ok) throw new Error('GPT 历史读取失败，请重新读取')
  const records = await (async () => {
      try {
        const response = await gptGateway('chat-requests', { action: 'audit-list', session_id: sessionId,
          ...(beforeCursor ? { before_cursor: Number(beforeCursor) || 1 } : {}),
          request_ids: history.turns.map(turn => turn.request_id).filter(Boolean) })
        if (!response.ok) throw new Error('发送前审计记录暂不可读')
        const value = await response.json() as { ok: boolean; records: GptAuditRecord[]; matched_records?: GptAuditRecord[]; before_cursor: number | null }
        if (!value.ok || !Array.isArray(value.records)) throw new Error('发送前审计记录格式无效')
        return { ...value, records: [...value.records, ...(value.matched_records || [])], error: null }
      } catch { return { ok: false, records: [] as GptAuditRecord[], before_cursor: null, error: '发送前审计记录读取失败；不能据此判断为未记录，请重新读取。' } }
    })()
  const byRequest = new Map(records.records.map(record => [record.request_id, record]))
  const turns: GptAuditTurn[] = history.turns.map(turn => {
    let raw: Record<string, unknown> = {}
    try { raw = JSON.parse(turn.raw_json || '{}') } catch { /* Old invalid raw is unknown. */ }
    const evidence = byRequest.get(turn.request_id || '') || null
    byRequest.delete(turn.request_id || '')
    return { request_id: turn.request_id || `turn-${turn.id}`, round_id: turn.round_id, created_at: turn.created_at,
      model: turn.model || '', usage: actualUsage(raw.usage) || actualUsage(evidence?.usage),
      context: raw.context && typeof raw.context === 'object' ? raw.context as Record<string, unknown> : {}, evidence }
  })
  for (const evidence of byRequest.values()) turns.push({ request_id: evidence.request_id, round_id: null,
    created_at: evidence.prepared_at, model: evidence.snapshot.model, usage: evidence.usage || null,
    context: evidence.snapshot.context, evidence })
  turns.sort(sortGptAuditTurns)
  return { ok: true, engine: 'gpt_subscription', session_id: sessionId, title: session.title || sessionId,
    context_revision: session.context_revision, turns, records_error: records.error,
    before_cursor: records.before_cursor, has_more_turns: history.turns.length === 20,
    before_turn_id: history.turns.length === 20 ? history.turns[0].id : null }
}
