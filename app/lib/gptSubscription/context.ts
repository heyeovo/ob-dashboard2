import { buildPersonaAppend, type HavenPersona } from '../havenPersonas'
import { composeWindowPersonaAppend } from '../cc/windowPrompt'
import { beijingRuntimeContext } from '../runtimeContext'
import { estimateTokens } from '../selfhost/contextBudget'
import type { HavenConversationSession, HavenTurn } from '../havenTurns'
import { GptTransportError, type GptInput, type GptImageContent } from './transport'

// Application admission budget, not a claimed GPT model context-window size.
export const GPT_INPUT_BUDGET = 120_000
export function turnRecall(turn: HavenTurn): string {
  try {
    const raw = JSON.parse(turn.raw_json || '{}')
    return typeof raw.recall?.additional_context === 'string' ? raw.recall.additional_context : ''
  } catch { return '' }
}

function recallBlock(value: string) {
  return value.trim() ? `<haven_recall_reference>\n${value.trim()}\n</haven_recall_reference>` : ''
}

function turnUserContent(turn: HavenTurn): string {
  if (turn.source === 'gpt_subscription') {
    try {
      const runtime = JSON.parse(turn.raw_json || '{}')?.gpt_runtime_context
      if (typeof runtime === 'string' && runtime.length > 0 && runtime.length <= 1024) {
        return `${turn.user_text}\n\n${runtime}`
      }
    } catch { /* Old or malformed metadata must not invent a historical time. */ }
  }
  return turn.user_text || ''
}

export function buildGptContext(input: {
  persona: HavenPersona; session: HavenConversationSession; history: HavenTurn[]
  rollingAppend: string; recall: string; text: string; now?: Date; mcpEnabled?: boolean
  image?: { url: string; roundId: number | null }
}) {
  const persona = buildPersonaAppend(input.persona, input.session.prompt_module_overrides)
  const window = composeWindowPersonaAppend(persona, input.session, input.session.session_id, input.rollingAppend)
  const capability = [
    input.image ? '可读取本轮附带的一张用户图片。' : '',
    input.mcpEnabled
      ? '可以调用本轮提供的 MCP 工具。工具只有返回成功才算执行完成；写入结果未知时不要重试。'
      : '当前线路仅提供文字回复。',
  ].filter(Boolean).join(' ')
  const imageRound = input.image?.roundId
  const userContentWithImage = (text: string, roundId: number | null): string | GptImageContent =>
    input.image && imageRound === roundId
      ? [{ type: 'input_text', text: text.trim() ? text : '（用户发送了一张图片）' },
        { type: 'input_image', image_url: input.image.url, detail: 'auto' }]
      : text
  const recalledCurrent = recallBlock(input.recall)
  const instructions = [window, capability].filter(Boolean).join('\n\n')
  const currentTime = beijingRuntimeContext(input.now)
  const current = `${input.text}\n\n${currentTime}`
  const fixed = Math.ceil((estimateTokens(instructions) + estimateTokens(current)
    + estimateTokens(recalledCurrent) + 16 + (recalledCurrent ? 8 : 0)) * 1.05)
  if (fixed > GPT_INPUT_BUDGET) throw new Error('人设、背景和当前消息过长，请减少带入的日期或记忆')
  const selected: HavenTurn[] = []
  let total = fixed
  let messages = 1 + Number(Boolean(recalledCurrent))
  for (let i = input.history.length - 1; i >= 0; i--) {
    const turn = input.history[i]
    const recalled = turnRecall(turn)
    const userContent = turnUserContent(turn)
    const count = Number(Boolean(turn.user_text) || turn.round_id === imageRound) + Number(Boolean(turn.assistant_text)) + Number(Boolean(recalled))
    const tokens = Math.ceil((estimateTokens(userContent) + estimateTokens(turn.assistant_text)
      + estimateTokens(recallBlock(recalled)) + 16) * 1.05)
    if (total + tokens > GPT_INPUT_BUDGET || messages + count > 1999) break
    selected.unshift(turn); total += tokens; messages += count
  }
  if (typeof imageRound === 'number' && !selected.some(turn => turn.round_id === imageRound)) {
    throw new GptTransportError('attachment_context_limit', '历史图片超出本轮上下文，请重新选图发送')
  }
  const history: GptInput[] = []
  const sourceRounds: Array<number | null> = []
  for (const turn of selected) {
    const recalled = recallBlock(turnRecall(turn))
    if (recalled) history.push({ role: 'developer', content: recalled })
    if (turn.user_text || turn.round_id === imageRound) history.push({ role: 'user', content: userContentWithImage(turnUserContent(turn), turn.round_id) })
    if (turn.assistant_text) history.push({ role: 'assistant', content: turn.assistant_text })
    for (let i = sourceRounds.length; i < history.length; i++) sourceRounds.push(turn.round_id)
  }
  if (recalledCurrent) {
    history.push({ role: 'developer', content: recalledCurrent })
    sourceRounds.push(null)
  }
  history.push({ role: 'user', content: userContentWithImage(current, null) })
  sourceRounds.push(null)
  return { instructions, input: history, sourceRounds,
    auditParts: { persona, window, background: input.rollingAppend, capability, recall: recalledCurrent, current_text: input.text, current_time: currentTime },
    context: {
    estimator: 'utf8-bytes-div-3-v1', estimate_safety_ratio: 1.05,
    input_tokens_estimated: total, application_input_budget: GPT_INPUT_BUDGET,
    model_context_limit: null, included_history_rounds: selected.length,
    omitted_history_rounds: input.history.length - selected.length,
    context_revision: input.session.context_revision,
  } }
}
