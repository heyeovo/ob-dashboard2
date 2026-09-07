export type RecallDisplayModule = {
  key: string
  card_count: number
  chars: number
  estimated_tokens: number
  text: string
}

/** UI-only estimate: CJK text is denser than Latin text in common tokenizers. */
export function estimateTextTokens(text: string): number {
  let estimate = 0
  for (const char of String(text || '')) {
    estimate += /[\u3400-\u9fff\uf900-\ufaff]/.test(char) ? 1.3 : 0.25
  }
  return Math.ceil(estimate)
}

export function splitRecallModules(
  additionalContext: string,
  cardCount: number,
): RecallDisplayModule[] {
  const ctx = additionalContext || ''
  if (!ctx.trim()) return []
  const modules: RecallDisplayModule[] = []

  const dateMatch = ctx.match(/\[date_recall\]([\s\S]*?)\[\/date_recall\]/)
  if (dateMatch) {
    const text = dateMatch[1].trim()
    if (text) modules.push({
      key: 'date_recall',
      card_count: 0,
      chars: text.length,
      estimated_tokens: estimateTextTokens(text),
      text,
    })
  }

  const cardTexts: string[] = []
  const cardRe = /\[memory_card[^\]]*\]([\s\S]*?)\[\/memory_card\]/g
  let match: RegExpExecArray | null
  while ((match = cardRe.exec(ctx)) !== null) {
    const text = match[1].trim()
    if (text) cardTexts.push(text)
  }
  if (cardTexts.length > 0) {
    const text = cardTexts.join('\n\n')
    modules.push({
      key: 'memory_card',
      card_count: cardCount,
      chars: text.length,
      estimated_tokens: estimateTextTokens(text),
      text,
    })
  }
  if (modules.length === 0) {
    const text = ctx.trim()
    modules.push({
      key: 'memory_card',
      card_count: cardCount,
      chars: text.length,
      estimated_tokens: estimateTextTokens(text),
      text,
    })
  }
  return modules
}
