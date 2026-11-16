// Browser-safe evidence only: never prompt bodies, credentials or raw headers.
export type GptDigest = { hash: string; bytes: number }
export type GptAuditSnapshot = {
  version: 1; algorithm: 'sha256-json-sorted-v1'; model: string; body_hash: string
  instructions: GptDigest; parts: Record<string, GptDigest>
  messages: Array<GptDigest & { role: string; source_round_id: number | null; prefix_hash: string }>
  context: Record<string, unknown>
}
export type GptAuditRecord = {
  request_id: string; session_id: string; cursor?: number
  snapshot: GptAuditSnapshot; prepared_at: string; sending_at?: string; acknowledged_at?: string
  finished_at?: string; outcome?: string; official_request_id?: string; response_id?: string
  usage?: Record<string, number | null> | null
}
export type GptAuditTurn = {
  request_id: string; round_id: number | null; created_at: string; model: string
  usage: Record<string, number | null> | null; context: Record<string, unknown>
  evidence: GptAuditRecord | null
}
export type GptAuditData = {
  ok: true; engine: 'gpt_subscription'; session_id: string; title: string
  context_revision: number; turns: GptAuditTurn[]; before_cursor: number | null
  records_error: string | null; has_more_turns: boolean; before_turn_id: number | null
}

export function sortGptAuditTurns(a: GptAuditTurn, b: GptAuditTurn) {
  const timestamp = (value: string) => {
    const normalized = value.replace(' ', 'T')
    return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`)
  }
  const difference = timestamp(a.created_at) - timestamp(b.created_at)
  return Number.isFinite(difference) ? difference : a.created_at.localeCompare(b.created_at)
}

export function compareGptAudits(a?: GptAuditSnapshot | null, b?: GptAuditSnapshot | null) {
  if (!a || !b) return '缺少发送前记录，无法比较'
  if (a.algorithm !== b.algorithm || a.version !== b.version) return '记录版本不同，无法比较'
  if (a.model !== b.model) return '模型已变化'
  if (a.instructions.hash !== b.instructions.hash) {
    const names: Record<string, string> = { persona: '人设', window: '窗口指令', background: '背景', capability: '能力说明', recall: '本轮召回' }
    const changed = Object.keys(names).filter(key => a.parts[key]?.hash !== b.parts[key]?.hash)
    return `instructions 已变化${changed.length ? `：${changed.map(key => names[key]).join('、')}` : ''}`
  }
  const count = Math.min(a.messages.length, b.messages.length)
  for (let i = 0; i < count; i++) {
    if (a.messages[i].hash !== b.messages[i].hash) return `instructions 一致；前 ${i} 条消息一致，第 ${i + 1} 条首次不同（${a.messages[i].role} → ${b.messages[i].role}）`
  }
  return `instructions 一致；前 ${count} 条消息一致${a.messages.length === b.messages.length ? '，全部消息一致' : '，其后为新增或移除的尾部'}`
}
