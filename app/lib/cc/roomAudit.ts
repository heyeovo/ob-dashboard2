/** Browser-only projection of native transcript; never modifies the native store. */
export function publicRoomTranscript<T>(entries: T[]): T[] {
  let active = false
  const privateTools = new Set<string>()
  const leaveTools = new Set<string>()
  return entries.map(entry => {
    const record = entry as Record<string, unknown>
    if (!record.message || typeof record.message !== 'object') return entry
    const message = record.message as Record<string, unknown>
    const content = message.content
    if (!Array.isArray(content)) {
      // A real user message starts a new turn; the previous visit auto-ended.
      if (message.role === 'user') active = false
      if (!active) return entry
      return { ...record, message: { ...message, content: '【房间】过程已封存' } } as T
    }
    if (message.role === 'user' && !content.some(b => b?.type === 'tool_result')) active = false
    const visible: Record<string, unknown>[] = []
    for (const raw of content) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as Record<string, unknown>
      if (block.type === 'tool_use') {
        const input = block.input as Record<string, unknown> | undefined
        const room = /^mcp__.+__room$/.test(String(block.name || ''))
        if (room && input?.action === 'open') active = false
        else if (room && !active) {
          active = true
          if (visible.at(-1)?.type === 'thinking') visible.pop()
        }
        if (active) {
          privateTools.add(String(block.id))
          if (room && input?.action === 'leave') leaveTools.add(String(block.id))
          continue
        }
      }
      if (block.type === 'tool_result' && privateTools.has(String(block.tool_use_id))) {
        if (leaveTools.has(String(block.tool_use_id))) active = false
        continue
      }
      if (active) continue
      visible.push(block)
    }
    return { ...record, message: { ...message, content: visible.length ? visible : '【房间】过程已封存' } } as T
  })
}
