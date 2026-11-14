import { buildPersonaAppend, type HavenPersona } from '../havenPersonas'
import { composeWindowPersonaAppend } from '../cc/windowPrompt'
import { beijingRuntimeContext } from '../runtimeContext'
import { estimateTokens } from '../selfhost/contextBudget'
import type { HavenConversationSession, HavenTurn } from '../havenTurns'
import type { GptInput } from './transport'

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

export function buildGptContext(input: {
  persona: HavenPersona; session: HavenConversationSession; history: HavenTurn[]
  rollingAppend: string; recall: string; text: string; now?: Date
}) {
  const instructions = [composeWindowPersonaAppend(
    buildPersonaAppend(input.persona, input.session.prompt_module_overrides),
    input.session, input.session.session_id, input.rollingAppend),
  '当前线路仅提供文字回复，没有工具、附件读取、房间、主动唤醒或工作模式能力。',
  recallBlock(input.recall)].filter(Boolean).join('\n\n')
  const current = `${input.text}\n\n${beijingRuntimeContext(input.now)}`
  const fixed = Math.ceil((estimateTokens(instructions) + estimateTokens(current) + 16) * 1.05)
  if (fixed > GPT_INPUT_BUDGET) throw new Error('人设、背景和当前消息过长，请减少带入的日期或记忆')
  const selected: HavenTurn[] = []
  let total = fixed
  let messages = 1
  for (let i = input.history.length - 1; i >= 0; i--) {
    const turn = input.history[i]
    const recalled = turnRecall(turn)
    const count = Number(Boolean(turn.user_text)) + Number(Boolean(turn.assistant_text)) + Number(Boolean(recalled))
    const tokens = Math.ceil((estimateTokens(turn.user_text) + estimateTokens(turn.assistant_text)
      + estimateTokens(recallBlock(recalled)) + 16) * 1.05)
    if (total + tokens > GPT_INPUT_BUDGET || messages + count > 1999) break
    selected.unshift(turn); total += tokens; messages += count
  }
  const history: GptInput[] = []
  for (const turn of selected) {
    const recalled = recallBlock(turnRecall(turn))
    if (recalled) history.push({ role: 'developer', content: recalled })
    if (turn.user_text) history.push({ role: 'user', content: turn.user_text })
    if (turn.assistant_text) history.push({ role: 'assistant', content: turn.assistant_text })
  }
  history.push({ role: 'user', content: current })
  return { instructions, input: history, context: {
    estimator: 'utf8-bytes-div-3-v1', estimate_safety_ratio: 1.05,
    input_tokens_estimated: total, application_input_budget: GPT_INPUT_BUDGET,
    model_context_limit: null, included_history_rounds: selected.length,
    omitted_history_rounds: input.history.length - selected.length,
    context_revision: input.session.context_revision,
  } }
}
