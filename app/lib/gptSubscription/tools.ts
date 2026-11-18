import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { CcToolEvent } from '@/app/cc/types'
import { answerPermission, requestPermission } from '../ccChannel'
import { builtInMcpPermissionForTool } from '../cc/builtInMcp'
import { loadMcpConfig } from '../ccMcp'
import { getConversationSession } from '../havenTurns'
import { createSelfhostMcpRuntime, type SelfhostMcpRuntime, type SelfhostMcpTool } from '../selfhost/mcp'
import { windowMcpConfig } from '../windowMcp'
import { canonicalJson } from './audit'
import { GptTransportError, type GptToolItem, type GptToolNamespace } from './transport'

export const GPT_TOOL_STEPS = 4
const MAX_CALLS = 8
const RESULT_BYTES = 8192
const ARGUMENT_BYTES = 4096

const id = (prefix: string, name: string) => `${prefix}_${createHash('sha256').update(name).digest('hex').slice(0, 32)}`

function resultText(text: string) {
  const bytes = Buffer.from(text)
  if (bytes.length <= RESULT_BYTES) return text
  const suffix = '\n（结果已截断）'
  return bytes.subarray(0, RESULT_BYTES - Buffer.byteLength(suffix) - 3).toString('utf8') + suffix
}

async function livePermission(runtime: SelfhostMcpRuntime, sessionId: string, tool: SelfhostMcpTool, signal: AbortSignal) {
  const [session, config] = await Promise.all([
    getConversationSession(sessionId, { signal }),
    loadMcpConfig().catch(() => null),
  ])
  if (!session.ok || !session.session || session.session.deleted_at || !config) return 'deny'
  const windowConfig = windowMcpConfig(config, session.session.mcp_overrides)
  if (tool.builtIn) return builtInMcpPermissionForTool(tool.name, windowConfig.builtIns, config.builtInPermissions) || 'deny'
  const previous = runtime.configuredServer?.(tool.serverName)
  const server = windowConfig.servers.find(item => item.name === tool.serverName)
  if (!previous || !server?.enabled || server.tools?.find(item => item.name === tool.name)?.enabled === false) return 'deny'
  const { transport, url, command, args, headers, env } = server
  if (canonicalJson({ transport, url, command, args, headers, env }) !== canonicalJson({
    transport: previous.transport, url: previous.url, command: previous.command, args: previous.args,
    headers: previous.headers, env: previous.env,
  })) return 'deny'
  return server.toolPermissions?.[tool.name] || server.permission
}

async function ask(sessionId: string, name: string, description: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const id = randomUUID()
  const decision = requestPermission(sessionId, {
    id, toolName: name, kind: 'other', title: `${name} 需要你的批准`, description,
    filePath: '', command: '', diff: null, suggestions: [],
  })
  const cancel = () => answerPermission(sessionId, id, { behavior: 'deny', message: '本轮已停止，工具未执行。' })
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try { return await decision }
  finally { signal.removeEventListener('abort', cancel) }
}

export async function openGptTools(sessionId: string, overrides: Record<string, boolean> | undefined, signal: AbortSignal) {
  const runtime = await createSelfhostMcpRuntime(signal, overrides, { interactive: true, sessionId })
  const tools = new Map<string, SelfhostMcpTool>()
  const groups = new Map<string, GptToolNamespace>()
  const calls = new Set<string>()
  const attempted = new Set<string>()
  for (const tool of runtime.tools) {
    const name = id('mcp', tool.name)
    const namespace = id('server', tool.serverName)
    const group = groups.get(namespace) || {
      type: 'namespace', name: namespace, description: `MCP · ${tool.serverName}`, tools: [],
    }
    // Descriptions carry the configured tool name so the model can select it by name.
    group.tools.push({ type: 'function', name, description: `${tool.remoteName} — ${tool.description || ''}`,
      parameters: tool.input_schema, strict: false })
    groups.set(namespace, group)
    tools.set(name, tool)
  }
  return {
    namespaces: [...groups.values()],
    warnings: runtime.warnings,
    close: () => runtime.close(),
    async execute(items: GptToolItem[], emit: (tool: CcToolEvent, saveResult?: boolean) => void): Promise<GptToolItem[]> {
      const pending = items.filter(item => item.type === 'function_call')
      const batch = new Set<string>()
      for (const call of pending) {
        const callId = call.call_id
        if (typeof callId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(callId)) {
          throw new GptTransportError('invalid_tool_call', 'GPT 工具调用标识无效')
        }
        if (batch.has(callId) || calls.has(callId)) {
          throw new GptTransportError('duplicate_tool_call', 'GPT 重复发送了同一个工具调用，已停止执行')
        }
        batch.add(callId)
      }
      const outputs: GptToolItem[] = []
      for (const call of pending) {
        signal.throwIfAborted()
        const callId = call.call_id as string
        calls.add(callId)
        const tool = typeof call.name === 'string' ? tools.get(call.name) : undefined
        const validNamespace = tool && (call.namespace === undefined || call.namespace === id('server', tool.serverName))
        const args = typeof call.arguments === 'string' ? call.arguments : ''
        let input: Record<string, unknown> | undefined
        if (args && Buffer.byteLength(args) <= ARGUMENT_BYTES) {
          try {
            const parsed: unknown = JSON.parse(args)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>
          } catch { /* Report malformed arguments through the existing tool card. */ }
        }
        const event: CcToolEvent = {
          id: callId, name: tool?.name || '未知 MCP 工具', input, status: 'running', startedAt: Date.now(),
        }
        emit(event)
        let result: string | undefined
        let error: string | undefined
        let status: CcToolEvent['status'] = 'denied'
        if (calls.size > MAX_CALLS) error = '本轮工具调用已达上限，未执行。'
        else if (!tool || !validNamespace) error = '此 MCP 工具未启用或不属于当前服务，未执行。'
        else if (!input) error = 'MCP 工具参数无效或过大，未执行。'
        else {
          const key = canonicalJson({ name: tool.name, input })
          if (attempted.has(key)) error = '本轮已经处理过同一个操作，未重复执行。'
          else {
            attempted.add(key)
            const permission = await livePermission(runtime, sessionId, tool, signal)
            signal.throwIfAborted()
            let allowed = permission === 'allow'
            if (permission === 'ask') {
              const decision = await ask(sessionId, tool.name, JSON.stringify(input, null, 2), signal)
              if (decision.behavior === 'deny') error = decision.message
              else allowed = await livePermission(runtime, sessionId, tool, signal) !== 'deny'
            }
            signal.throwIfAborted()
            if (allowed) {
              const reply = await runtime.callTool({ name: tool.name, input }, signal)
              if (signal.aborted) {
                emit({ ...event, status: 'error', error: '本轮已停止，工具执行状态可能需要核对。' })
                signal.throwIfAborted()
              }
              status = reply.isError ? 'error' : 'completed'
              if (reply.isError) error = reply.text
              else result = reply.text
            } else error ||= '此 MCP 工具当前未获授权，未执行。'
          }
        }
        const output = resultText(error || result || '工具完成。')
        emit({ ...event, status, durationMs: Date.now() - event.startedAt!,
          ...(error ? { error: output } : { result: output }) }, tool?.saveResults)
        outputs.push({ type: 'function_call_output', call_id: callId, output })
      }
      return outputs
    },
  }
}
