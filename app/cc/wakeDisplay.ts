export type WakeDisplayOp = { action: 'schedule' | 'cancel' | 'followup'; at?: string; reason?: string }

export function parseWakeOps(value: unknown): WakeDisplayOp[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const op = item as Record<string, unknown>
    if (op.action !== 'schedule' && op.action !== 'cancel' && op.action !== 'followup') return []
    return [{ action: op.action, at: typeof op.at === 'string' ? op.at : undefined,
      reason: typeof op.reason === 'string' ? op.reason : undefined } as WakeDisplayOp]
  })
}

export function wakeDisplayLines(message: { wakeOps?: WakeDisplayOp[]; nextWake?: { at: string; reason: string } }): string[] {
  const clock = (at: string) => new Date(at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
  if (message.wakeOps) return message.wakeOps.map(op => {
    if (op.action === 'cancel') return op.at ? `↳ 取消闹钟 ${clock(op.at)}` : '↳ 取消全部闹钟'
    return `↳ ${op.action === 'schedule' ? '闹钟' : '下次唤醒'} ${op.at ? clock(op.at) : ''}${op.reason ? ` · ${op.reason}` : ''}`
  })
  return message.nextWake ? [`↳ 下次唤醒 ${clock(message.nextWake.at)}${message.nextWake.reason ? ` · ${message.nextWake.reason}` : ''}`] : []
}
