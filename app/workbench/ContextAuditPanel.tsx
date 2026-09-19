'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ACTIVE_SESSION_KEY } from '../cc/ccHistory'
import Stat from '../components/Stat'

type AuditMessage = {
  id: string
  turn_id: number
  round_id: number
  day: string
  created_at: string
  turn_kind: string
  role: 'user' | 'assistant'
  content: string
  chars: number
}

type AuditData = {
  ok: true
  session_id: string
  title: string
  strategy: 'fixed_window' | 'daily_rolling'
  context_revision: number
  timezone: string
  day_start_hour: number
  days: Array<{ day: string; mode: 'raw' | 'review' | 'omit'; turn_count: number; raw_chars: number; review_chars: number }>
  rolling: {
    turn_count: number
    message_count: number
    char_count: number
    messages: AuditMessage[]
    background_content: string
    pinned_bucket_ids: string[]
    selected_journal_ids: string[]
  }
  transcript: {
    available: boolean
    entry_count: number
    message_count: number
    matched_source_messages: number
    expected_source_messages: number
    rolling_wrapper_messages: number
    memory_recall_messages: number
    tool_use_messages: number
    tool_result_messages: number
    body_restored_messages: number
    messages: Array<{
      index: number
      uuid: string
      role: string
      content: string
      chars: number
      containsRollingWindowContext: boolean
      containsMemoryRecall: boolean
      blockTypes: string[]
      toolNames: string[]
      bodyRestored: boolean
    }>
  }
  rolling_seed: Record<string, unknown> | null
  rolling_alignment: {
    available: boolean
    aligned: boolean
    envelopeCount: number
    matchedTurnCount: number
    isolatedIncompleteCount: number
    error: string
    issues: Array<{
      envelopeIndex: number
      entryIndex: number
      userUuid: string
      timestamp: string
      agentWake: boolean
      reason: 'missing_haven_user' | 'assistant_mismatch'
      havenUserCandidateCount: number
      havenUserCandidateIds: number[]
    }>
    missingRawTurns: Array<{
      id: number
      day: string
      createdAt: string
      turnKind: string
      userChars: number
      assistantChars: number
      fullSourceRequired: boolean
    }>
    unrepresentedEmptyWakeCount: number
    recoveredAssistantMismatchCount: number
  } | null
  system_prompt: {
    current: {
      mode: string
      sdk_shape: string
      system_hash: string
      dashboard_append: string
      chars: number
      modules: Array<{ id: string; name: string; enabled: boolean; chars: number }>
    }
    latest: {
      available: boolean
      source: 'stored_snapshot' | 'current_hash_match' | 'unavailable'
      request_id: string
      recorded_at: string
      mode: string
      sdk_shape: string
      system_hash: string
      dashboard_append: string
      chars: number
    }
    hash_match: boolean
  }
  latest: {
    turn_id: number | null
    created_at: string
    rolling_context_revision: number
    usage: Record<string, unknown> | null
    cache_diagnostic: Record<string, unknown> | null
  }
  stats: {
    live: boolean
    model: string
    contextTokens: number
    contextMaxTokens: number
    contextSnapshot: { totalTokens?: number; maxTokens?: number } | null
  }
  at: number
}

function number(value: unknown): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString('zh-CN') : '—'
}

function text(value: unknown): string {
  return typeof value === 'string' && value ? value : '—'
}

export default function ContextAuditPanel() {
  const [sessionId, setSessionId] = useState('')
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setSessionId(window.localStorage.getItem(ACTIVE_SESSION_KEY) || '')
      } catch {
        setSessionId('')
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const refresh = useCallback(async () => {
    if (!sessionId || loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/cc-context-audit?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(String(payload.error || '读取失败'))
      setData(payload as AuditData)
    } catch (reason) {
      setError((reason as Error).message || '读取失败')
    } finally {
      setLoading(false)
    }
  }, [loading, sessionId])

  const usage = data?.latest.usage
  const cache = data?.latest.cache_diagnostic
  const rawDays = data?.days.filter(day => day.mode === 'raw' && day.turn_count > 0) || []
  const reportedContext = data?.stats.contextSnapshot?.totalTokens || data?.stats.contextTokens || 0
  const transcriptVerified = Boolean(
    data?.transcript.available
    && data.transcript.expected_source_messages > 0
    && data.transcript.matched_source_messages === data.transcript.expected_source_messages
    && data.transcript.rolling_wrapper_messages === 0,
  )

  return (
    <details
      className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
      onToggle={event => {
        if (event.currentTarget.open && !data && !loading) void refresh()
      }}
    >
      <summary className="cursor-pointer list-none px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-[var(--color-text-heading)]">本轮上下文审计</div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">核对实际选入的原文、背景拼接和 SDK 最近一轮用量</div>
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)] group-open:hidden">展开</span>
          <span className="hidden text-xs text-[var(--color-text-tertiary)] group-open:inline">收起</span>
        </div>
      </summary>

      <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
        {!sessionId ? (
          <p className="text-sm text-[var(--color-text-secondary)]">还没有当前会话。先去 <Link className="underline" href="/cc">聊天页</Link> 打开一个会话。</p>
        ) : null}
        {loading ? <p className="text-sm text-[var(--color-text-tertiary)]">正在读取 Haven 和最近一轮记录…</p> : null}
        {error ? <p className="rounded-lg bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p> : null}

        {data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-tertiary)]">
              <span>{data.title} · revision {data.context_revision} · {data.stats.live ? '活会话' : '当前进程未复用'}</span>
              <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-tertiary)] disabled:opacity-50">重新读取</button>
            </div>

            {data.latest.rolling_context_revision > 0 && data.latest.rolling_context_revision !== data.context_revision ? (
              <p className="rounded-lg bg-[var(--color-pending-bg)] px-3 py-2 text-xs text-[var(--color-pending)]">当前配置是 revision {data.context_revision}，最近一条消息实际使用的是 revision {data.latest.rolling_context_revision}。下面原文按当前配置重建；请发一条新消息后再核对本轮结果。</p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label={`滚动原文 · ${rawDays.length} 天 · ${number(data.rolling.char_count)} 字符`} value={`${number(data.rolling.message_count)} 条`} />
              <Stat label={`SDK 报告上下文 · ${data.stats.model || '尚无模型报告'}`} value={reportedContext ? `${number(reportedContext)} tok` : '—'} />
              <Stat label={`最近缓存读 · 输入 ${number(usage?.inputTokens)}`} value={`${number(usage?.cacheReadTokens)} tok`} />
              <Stat label={`最近缓存写 · ${text(cache?.iterator)} · turn ${data.latest.turn_id ?? '—'}`} value={`${number(usage?.cacheWriteTokens)} tok`} />
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">日期模式</div>
              <div className="flex flex-wrap gap-1.5">
                {data.days.filter(day => day.turn_count > 0).map(day => (
                  <span key={day.day} className={`rounded-full px-2.5 py-1 text-[11px] ${day.mode === 'raw' ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' : day.mode === 'review' ? 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]' : 'bg-[var(--color-archived-bg)] text-[var(--color-archived)]'}`}>
                    {day.day} · {day.mode} · {day.turn_count}轮
                  </span>
                ))}
              </div>
            </div>

            <details className="rounded-xl border border-[var(--color-border)]">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">查看选入 SDK 种子的 Haven 原文（{data.rolling.message_count} 条）</summary>
              <div className="max-h-[36rem] space-y-2 overflow-auto border-t border-[var(--color-border)] p-3">
                {data.rolling.messages.length ? data.rolling.messages.map(message => (
                  <article key={`${message.turn_id}-${message.role}`} className="rounded-lg bg-[var(--color-bg)] p-3">
                    <div className="mb-2 text-[11px] text-[var(--color-text-tertiary)]">{message.day} · {message.role} · turn {message.turn_id} · {message.id} · {number(message.chars)} 字符</div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--color-text-secondary)]">{message.content}</pre>
                  </article>
                )) : <p className="text-xs text-[var(--color-text-tertiary)]">没有原文被选入。固定窗口也不会在这里重建滚动种子。</p>}
              </div>
            </details>

            <details className="rounded-xl border border-[var(--color-border)]">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">SDK transcript 落盘验证</summary>
              <div className="space-y-3 border-t border-[var(--color-border)] p-3">
                {!data.transcript.available ? (
                  <p className="rounded-lg bg-[var(--color-surface-secondary)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">未找到这条会话的持久 transcript。常见原因是固定窗口、尚未发出新消息，或旧 session ID 没有对应的持久文件。</p>
                ) : transcriptVerified ? (
                  <p className="rounded-lg bg-[var(--color-digested-bg)] px-3 py-2 text-xs text-[var(--color-digested)]">已验证：{data.transcript.matched_source_messages}/{data.transcript.expected_source_messages} 条 Haven 原文在 SDK transcript 中以独立 user/assistant 消息存在；rolling_window_context 包装命中 0 条。</p>
                ) : (
                  <p className="rounded-lg bg-[var(--color-pending-bg)] px-3 py-2 text-xs text-[var(--color-pending)]">需要检查：原文匹配 {data.transcript.matched_source_messages}/{data.transcript.expected_source_messages} 条，rolling_window_context 包装命中 {data.transcript.rolling_wrapper_messages} 条。</p>
                )}
                {data.rolling_alignment ? (
                  <p className={`rounded-lg px-3 py-2 text-xs ${data.rolling_alignment.aligned ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' : 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]'}`}>
                    {data.rolling_alignment.aligned
                      ? `滚动对齐只读预检通过：${number(data.rolling_alignment.matchedTurnCount)}/${number(data.rolling_alignment.envelopeCount)} 个完整轮次可对应 Haven；隔离失败/中断的半截轮次 ${number(data.rolling_alignment.isolatedIncompleteCount)} 条。未保存设置。`
                      : `滚动对齐只读预检未通过：${data.rolling_alignment.error}。未保存设置。`}
                  </p>
                ) : null}
                {data.rolling_alignment?.aligned ? (
                  <div className={`rounded-lg px-3 py-2 text-xs ${data.rolling_alignment.missingRawTurns.length ? 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]' : 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]'}`}>
                    {data.rolling_alignment.missingRawTurns.length
                      ? `原文反向检查：${data.rolling_alignment.missingRawTurns.length} 个 Haven 原文轮次在旧 transcript 中缺少完整记录。以下仅列编号和时间，不含正文。`
                      : '原文反向检查通过：需要保留完整内容的 Haven 轮次均有对应的旧 transcript 记录。'}
                    {data.rolling_alignment.unrepresentedEmptyWakeCount ? (
                      <div className="mt-1">另有 {data.rolling_alignment.unrepresentedEmptyWakeCount} 条无用户/助手正文、且旧 transcript 没有对应轮次的空唤醒：记录保留在 Haven，不阻止重建；旧 transcript 中已有轮次的唤醒仍保留。</div>
                    ) : null}
                    {data.rolling_alignment.recoveredAssistantMismatchCount ? (
                      <div className="mt-1">另有 {data.rolling_alignment.recoveredAssistantMismatchCount} 条旧并发轮次已按唯一近时间 Haven 输入恢复关联：重建保留旧 transcript 的完整原生内容，不使用 Haven 的不同助手正文覆盖。</div>
                    ) : null}
                    {data.rolling_alignment.missingRawTurns.length ? (
                      <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                        {data.rolling_alignment.missingRawTurns.map(turn => (
                          <div key={turn.id}>
                            Haven #{turn.id} · {turn.day || '日期未知'} · {turn.createdAt || '时间未知'} · {turn.turnKind} · 用户 {turn.userChars} 字 / 助手 {turn.assistantChars} 字 · {turn.fullSourceRequired ? '要求完整旧轮次：重建会拦截正文降级' : '允许仅从 Haven 正文恢复'}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {data.rolling_alignment?.issues?.length ? (
                  <div className="space-y-2 text-xs">
                    <div className="font-medium text-[var(--color-text-secondary)]">无法对应的完整轮次（只读定位，不含聊天正文）</div>
                    {data.rolling_alignment.issues.map(issue => (
                      <div key={`${issue.envelopeIndex}-${issue.userUuid}`} className="rounded-lg bg-[var(--color-surface-secondary)] px-3 py-2 text-[var(--color-text-secondary)]">
                        <div>轮次 #{issue.envelopeIndex} · transcript 消息 #{issue.entryIndex} · {issue.agentWake ? '主动唤醒标记：有' : '主动唤醒标记：无'}</div>
                        <div>{issue.reason === 'missing_haven_user' ? 'Haven 没有相符的输入轮次' : 'Haven 有相符输入，但助手正文不一致'} · 输入候选 {issue.havenUserCandidateCount} 条{issue.havenUserCandidateIds.length ? `（Haven ID：${issue.havenUserCandidateIds.join('、')}${issue.havenUserCandidateCount > issue.havenUserCandidateIds.length ? '…' : ''}）` : ''}</div>
                        <div className="break-all text-[var(--color-text-tertiary)]">时间：{issue.timestamp || '未记录'} · UUID：{issue.userUuid || '未记录'}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {data.transcript.available ? (
                  <div className="space-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                    <div>SessionStore 共 {number(data.transcript.entry_count)} 条记录，其中 {number(data.transcript.message_count)} 条可审计消息。以下内容直接来自持久 transcript，不是按 Haven 配置推算。</div>
                    <div>工具调用 {number(data.transcript.tool_use_messages)} 条 · 工具结果 {number(data.transcript.tool_result_messages)} 条 · 召回包装 {number(data.transcript.memory_recall_messages)} 条 · 正文恢复标记 {number(data.transcript.body_restored_messages)} 条</div>
                    {data.rolling_seed ? <div>最近一次重建凭据：{JSON.stringify(data.rolling_seed)}</div> : <div>最近 50 轮没有找到持久化的重建凭据。</div>}
                  </div>
                ) : null}
                <div className="max-h-[36rem] space-y-2 overflow-auto">
                  {data.transcript.messages.map(message => (
                    <article key={`${message.index}-${message.uuid}`} className={`rounded-lg p-3 ${message.containsRollingWindowContext ? 'bg-[var(--color-danger-bg)]' : 'bg-[var(--color-bg)]'}`}>
                      <div className={`mb-2 text-[11px] ${message.containsRollingWindowContext ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-tertiary)]'}`}>#{message.index} · {message.role} · {number(message.chars)} 字符 · {message.blockTypes.join('+') || 'unknown'}{message.toolNames.length ? ` · ${message.toolNames.join(', ')}` : ''}{message.containsMemoryRecall ? ' · 记忆召回' : ''}{message.bodyRestored ? ' · 正文恢复' : ''}{message.containsRollingWindowContext ? ' · 命中 rolling_window_context' : ''}</div>
                      <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-5 text-[var(--color-text-secondary)]">{message.content}</pre>
                    </article>
                  ))}
                </div>
              </div>
            </details>

            <details className="rounded-xl border border-[var(--color-border)]">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">本轮 System Prompt（Dashboard 热更新部分）</summary>
              <div className="space-y-3 border-t border-[var(--color-border)] p-3 text-xs">
                {data.system_prompt.latest.source === 'stored_snapshot' ? (
                  <p className={`rounded-lg px-3 py-2 ${data.system_prompt.hash_match ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' : 'bg-[var(--color-pending-bg)] text-[var(--color-pending)]'}`}>已读取最近一次模型请求前落盘的实际快照。{data.system_prompt.hash_match ? '它与当前热更新内容一致。' : '它与当前热更新内容不同；下一轮会重建 SDK 会话并使用当前版本。'}</p>
                ) : data.system_prompt.latest.source === 'current_hash_match' ? (
                  <p className="rounded-lg bg-[var(--color-surface-secondary)] px-3 py-2 text-[var(--color-text-secondary)]">旧消息尚无正文快照，但最近一轮保存的 system hash 与当前正文一致，因此可确认当前正文就是该轮使用的 Dashboard 部分。再发一条消息后会产生独立落盘快照。</p>
                ) : (
                  <p className="rounded-lg bg-[var(--color-pending-bg)] px-3 py-2 text-[var(--color-pending)]">最近一轮没有可还原的 System Prompt 正文。发一条新消息后再点“重新读取”。</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Stat label={`最近实际 · ${data.system_prompt.latest.sdk_shape}`} value={`${number(data.system_prompt.latest.chars)} 字符`} />
                  <Stat label={`当前/下一轮 · ${data.system_prompt.current.sdk_shape}`} value={`${number(data.system_prompt.current.chars)} 字符`} />
                </div>

                <div>
                  <div className="mb-2 font-medium text-[var(--color-text-secondary)]">当前 Prompt 模块</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.system_prompt.current.modules.map(module => (
                      <span key={module.id} className={`rounded-full px-2.5 py-1 text-[11px] ${module.enabled ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' : 'bg-[var(--color-archived-bg)] text-[var(--color-archived)]'}`}>{module.name} · {module.enabled ? '启用' : '关闭'} · {number(module.chars)}字</span>
                    ))}
                  </div>
                </div>

                <details className="rounded-lg bg-[var(--color-bg)]">
                  <summary className="cursor-pointer px-3 py-2 font-medium text-[var(--color-text-secondary)]">查看最近一轮实际正文 · {data.system_prompt.latest.system_hash || '无 hash'}</summary>
                  <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] p-3 font-sans leading-5 text-[var(--color-text-secondary)]">{data.system_prompt.latest.dashboard_append || '没有可显示的快照'}</pre>
                </details>
                <details className="rounded-lg bg-[var(--color-bg)]">
                  <summary className="cursor-pointer px-3 py-2 font-medium text-[var(--color-text-secondary)]">查看当前/下一轮正文 · {data.system_prompt.current.system_hash}</summary>
                  <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] p-3 font-sans leading-5 text-[var(--color-text-secondary)]">{data.system_prompt.current.dashboard_append || '当前没有 Dashboard 追加正文'}</pre>
                </details>

                <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">闲聊模式的 custom 正文就是 Dashboard 提交的 system prompt。工作模式显示的是 Dashboard 追加到 Claude Code preset 后面的正文；SDK 内置 preset 的原文不由 Dashboard 提供，因此不伪造显示。</p>
              </div>
            </details>

            <details className="rounded-xl border border-[var(--color-border)]">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">查看背景拼接正文与工具指纹</summary>
              <div className="space-y-3 border-t border-[var(--color-border)] p-3 text-xs">
                <div className="text-[var(--color-text-tertiary)]">钉选 bucket：{data.rolling.pinned_bucket_ids.join('、') || '无'} · 日记：{data.rolling.selected_journal_ids.join('、') || '无'}</div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-bg)] p-3 font-sans leading-5 text-[var(--color-text-secondary)]">{data.rolling.background_content || '没有滚动背景正文'}</pre>
                <div className="text-[var(--color-text-tertiary)]">工具：{Array.isArray(cache?.tool_names) ? cache.tool_names.join('、') : '—'}</div>
                <div className="text-[var(--color-text-tertiary)]">MCP：{Array.isArray(cache?.mcp_server_names) ? cache.mcp_server_names.join('、') : '—'}</div>
              </div>
            </details>

            <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">这里显示 Dashboard 可验证的 SDK 输入：滚动种子原文、滚动背景，以及 SDK 回报的最近一轮 token/cache 数据。它不会拦截 OAuth，也不会显示密钥；SDK 内部最终 HTTP 封包不在可见范围内。</p>
          </div>
        ) : null}
      </div>
    </details>
  )
}
