import { loadSeatContext } from './seatContext'
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildCcEnv } from '../ccEnv'
import { runForegroundSubscriptionTurn } from '../cc/sessionTurnCoordinator'
import { isClaudeSessionLimitNotice } from '../cc/subscriptionLimit'
import { thinkingConfigForModel } from '../cc/ccOptions'
import { loadMcpConfig, toSdkMcpServers, disabledMcpTools } from '../ccMcp'
import { getPersona, buildPersonaAppend } from '../havenPersonas'
import { upstreamFromHaven, pickFromConfig } from '@/app/cc/upstream'
import { loadUpstreamConfig } from '../havenUpstream'
import { getHavenBaseUrl, joinHavenUrl } from '../havenConfig'
import type { TrpgSettings, YanzhiRuntime, YanzhiView } from './server'

export type TrpgTurnKind = 'table_talk' | 'action' | 'roll'
export const TRPG_SECTION = `现在在和小羊跑团（CoC 7 速成规则）。
游戏内行动只能用 submit_action，且只在轮到你时；掷骰只能用 roll_check。
你最后说的话会作为你的桌边话显示在小羊面前。
不要试图打听守秘人的秘密。
你的调查员有自己的判断：可以和小羊的调查员意见不同、可以犯傻、可以把事情搞砸，不用为了让她开心一路顺着她走。
觉得这段经历值得留下，就照平时的习惯存进 OB——写清楚这是你们一起跑团时发生的事。`

export function buildTrpgPrompt(kind: TrpgTurnKind, view: YanzhiView, runtime: YanzhiRuntime, fresh: boolean, background = ''): string {
  const lines = view.log.filter(log => log.seq > runtime.last_seen_seq).map(log => JSON.stringify([log.seq, log.author, log.kind, log.text])).join('\n')
  const seed = fresh ? `角色卡全文：${JSON.stringify(view.my_character)}\n最新前情提要：${view.latest_recap.public || ''}\n已公开线索：${JSON.stringify(view.clues)}\n最近 40 条可见日志：${JSON.stringify(view.log.slice(-40))}\n\n` : ''
  return `${fresh && background ? background + '\n\n' : ''}${seed}<trpg_turn kind="${kind}" />\n${lines}\n言之名下 pending 检定：${JSON.stringify(view.checks.filter(check => check.owner === 'yanzhi' && check.status === 'pending'))}`
}

export function trpgPublicError(error: unknown): string {
  const message = String(error instanceof Error ? error.message : error)
  if (/usage limit|rate limit|resets|credits_required|额度/i.test(message)) return 'Claude Pro 额度不足或正在限流，请稍后再试'
  if (/login|oauth|authentication|401/i.test(message)) return 'Claude Pro 登录已失效，需要重新登录'
  if (/abort|timeout|超时/i.test(message)) return '言之的跑团回合超时，请稍后再试'
  return '言之的跑团回合未完成，请稍后再试'
}

export async function runYanzhiTurn(kind: TrpgTurnKind, view: YanzhiView, runtime: YanzhiRuntime, settings: TrpgSettings) {
  // usePersonas.ts chooses remembered device preference, then list[0].
  // A server job has no device preference; getPersona('') uses the same list[0].
  const personaResult = await getPersona(settings.persona_id || '')
  if (!personaResult.ok || !personaResult.persona) throw new Error('协作者配置不可用')
  const config = await loadMcpConfig()
  const ob = { ...config, servers: config.servers.filter(server => server.name === 'ombre_brain') }
  const upstream = await loadUpstreamConfig()
  const defaults = pickFromConfig(upstreamFromHaven(upstream.config as Record<string, unknown>))
  const mainModel = settings.yanzhi_model
  const token = process.env.TRPG_PLAYER_MCP_TOKEN?.trim()
  if (!token) throw new Error('跑团玩家 MCP 未配置')
  const cwd = path.join(tmpdir(), 'ob2-trpg')
  await mkdir(cwd, { recursive: true })
  return runForegroundSubscriptionTurn(async () => {
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), 300000)
    const options: Options = {
      model: mainModel,
      systemPrompt: { type: 'custom', prompt: `${buildPersonaAppend(personaResult.persona)}\n\n${TRPG_SECTION}\n你扮演的调查员：${view.my_character?.name || ''}，职业：${view.my_character?.occupation || ''}`, snapshot: false },
      tools: [], mcpServers: { ...toSdkMcpServers(ob), trpg: { type: 'http', url: joinHavenUrl(getHavenBaseUrl(), '/trpg/player/mcp'), headers: { Authorization: `Bearer ${token}` } } },
      strictMcpConfig: true,
      disallowedTools: disabledMcpTools(ob),
      allowedTools: ['mcp__trpg__*', ...ob.servers.filter(server => server.enabled).flatMap(server => server.tools?.length ? server.tools.filter(tool => tool.enabled).map(tool => tool.name) : ['mcp__ombre_brain__*'])],
      permissionMode: 'dontAsk', settings: { autoMemoryEnabled: false }, settingSources: [],
      thinking: thinkingConfigForModel(mainModel, defaults.thinking),
      effort: defaults.effort as Options['effort'],
      cwd, env: buildCcEnv('subscription', { mainModel }), abortController,
    }
    async function execute(fresh: boolean) {
      const background = fresh ? await loadSeatContext(settings, personaResult.persona!.id) : ''
      const stream = query({ prompt: buildTrpgPrompt(kind, view, runtime, fresh, background), options: { ...options, resume: fresh ? undefined : runtime.session_id || undefined } })
      let text = '', sessionId = '', sessionTokens = 0, completed = false
      try {
        for await (const message of stream) {
          if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id
          if (message.type === 'assistant') {
            if (message.error) throw new Error(message.error)
            // Only the final assistant reply becomes table talk; tool preambles do not.
            text = message.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
          }
          if (message.type === 'result') {
            if (message.subtype !== 'success') throw new Error(message.errors.join('; '))
            if (isClaudeSessionLimitNotice(message.result)) throw new Error('usage limit')
            text = message.result || text
            sessionId = message.session_id || sessionId
            sessionTokens = (message.usage.input_tokens || 0) + (message.usage.cache_read_input_tokens || 0) + (message.usage.cache_creation_input_tokens || 0)
            completed = true
          }
        }
        if (!completed) throw new Error(abortController.signal.aborted ? 'timeout' : 'incomplete result')
        return { text: text.trim(), session_id: sessionId, session_tokens: sessionTokens }
      } finally { stream.close() }
    }
    try {
      const fresh = !runtime.session_id || runtime.session_tokens > 80000
      try { return await execute(fresh) } catch (error) {
        if (!fresh && /(?:resume|session).*(?:not found|missing|invalid|failed)|no conversation found/i.test(String(error))) return await execute(true)
        throw error
      }
    } finally { clearTimeout(timer) }
  })
}
