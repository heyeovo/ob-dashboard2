'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CcBuiltInMcpServer,
  CcMcpApplySummary,
  CcMcpConfig,
  CcMcpPermission,
  CcMcpServer,
  CcMcpServerStatus,
  CcMcpTransport,
} from '@/app/lib/ccMcpTypes'
import {
  estimateMcpConfigTokens,
  estimateMcpServerTokens,
  estimateMcpToolTokens,
} from '@/app/lib/contextTokenEstimate'

type ApiPayload = {
  ok?: boolean
  error?: string
  config?: CcMcpConfig
  apply?: CcMcpApplySummary
  status?: { servers: CcMcpServerStatus[] }
  builtIn?: CcBuiltInMcpServer[]
}

type Draft = {
  originalName: string
  name: string
  label: string
  enabled: boolean
  transport: CcMcpTransport
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
  timeout: string
  permission: CcMcpPermission
  toolPermissions: Record<string, CcMcpPermission>
  saveResults: boolean
}

const INPUT =
  'w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)]/50 focus:ring-2 focus:ring-[var(--color-primary)]/10'

function idFromLabel(value: string) {
  let id = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

  if (id && !/^[a-z]/.test(id)) id = `mcp_${id}`
  return id.slice(0, 64).replace(/_+$/g, '')
}

function emptyDraft(): Draft {
  return {
    originalName: '',
    name: '',
    label: '',
    enabled: true,
    transport: 'http',
    command: '',
    argsText: '',
    envText: '{}',
    url: '',
    headersText: '{}',
    timeout: '',
    permission: 'ask',
    toolPermissions: {},
    saveResults: true,
  }
}

function draftFromServer(server: CcMcpServer): Draft {
  return {
    originalName: server.name,
    name: server.name,
    label: server.label,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command || '',
    argsText: (server.args || []).join('\n'),
    envText: JSON.stringify(server.env || {}, null, 2),
    url: server.url || '',
    headersText: JSON.stringify(server.headers || {}, null, 2),
    timeout: server.timeout ? String(server.timeout) : '',
    permission: server.permission,
    toolPermissions: server.toolPermissions || {},
    saveResults: server.saveResults,
  }
}

function parseStringRecord(text: string, label: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text || '{}')
  } catch {
    throw new Error(`${label}不是正确的 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 { "名称": "值" }`)
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
      key,
      String(value ?? ''),
    ]),
  )
}

function permissionLabel(permission: CcMcpPermission) {
  if (permission === 'allow') return '自动允许'
  if (permission === 'deny') return '禁止'
  return '每次询问'
}

function statusLabel(status: string) {
  if (status === 'connected') return '已连接'
  if (status === 'failed') return '连接失败'
  if (status === 'needs-auth') return '需要登录'
  if (status === 'pending') return '连接中'
  return status || '未知'
}

function shortToolName(name: string) {
  const parts = name.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : name
}

function toolDisplayDescription(tool: { name: string; description?: string }) {
  return tool.description?.trim() || `调用 MCP 工具 ${shortToolName(tool.name)}`
}

export default function McpManager() {
  const [config, setConfig] = useState<CcMcpConfig>({
    version: 1,
    builtIns: { ombre_agent_wake: true },
    builtInPermissions: { yanzhi: 'allow' },
    servers: [],
  })
  const [builtIn, setBuiltIn] = useState<CcBuiltInMcpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<CcMcpServerStatus[]>([])

  useEffect(() => {
    let alive = true
    void fetch('/api/cc-mcp', { cache: 'no-store' })
      .then(async response => {
        const data = (await response.json()) as ApiPayload
        if (!response.ok || !data.ok || !data.config) {
          throw new Error(data.error || 'MCP 配置读取失败')
        }
        if (alive) {
          setConfig(data.config)
          setBuiltIn(data.builtIn || [])
        }
      })
      .catch(reason => {
        if (alive) setError((reason as Error).message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const statusByName = useMemo(
    () => new Map(statuses.map(status => [status.name, status])),
    [statuses],
  )
  const builtInTokens = useMemo(
    () => builtIn.reduce(
      (sum, server) => sum + (server.enabled
        ? server.tools.filter(tool => tool.enabled).reduce((toolSum, tool) => toolSum + estimateMcpToolTokens(tool), 0)
        : 0),
      0,
    ),
    [builtIn],
  )
  const totalMcpTokens = useMemo(
    () => estimateMcpConfigTokens(config) + builtInTokens,
    [builtInTokens, config],
  )
  const missingSchemaCount = useMemo(
    () => config.servers.reduce(
      (count, server) => count + (server.tools || []).filter(tool => !tool.inputSchema).length,
      0,
    ),
    [config],
  )

  const persist = useCallback(async (
    servers: CcMcpServer[],
    success: string,
    discover: string[] = [],
  ) => {
    setSaving(true)
    setError('')
    setNote('')
    try {
      const response = await fetch('/api/cc-mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servers,
          builtIns: config.builtIns,
          builtInPermissions: config.builtInPermissions,
          discover,
        }),
      })
      const data = (await response.json()) as ApiPayload
      if (!response.ok || !data.ok || !data.config) {
        throw new Error(data.error || '保存失败')
      }
      setConfig(data.config)
      setBuiltIn(data.builtIn || [])
      if (data.status) setStatuses(data.status.servers)
      const applied = data.apply?.applied || 0
      const queued = data.apply?.queued || 0
      const suffix =
        applied || queued
          ? ` ${applied ? `${applied} 个空闲窗口会在下一句话重载` : ''}${
              applied && queued ? '，' : ''
            }${queued ? `${queued} 个窗口会在本轮结束后重载` : ''}。`
          : ' 下次发言时自动加载。'
      const applyErrors = data.apply?.errors || []
      setNote(`${success}${suffix}${applyErrors.length ? ' 有连接报错，可刷新工具清单查看。' : ''}`)
    } catch (reason) {
      setError((reason as Error).message)
      throw reason
    } finally {
      setSaving(false)
    }
  }, [config.builtInPermissions, config.builtIns])

  const toggleBuiltIn = async (name: string, enabled: boolean) => {
    const previous = config
    const builtIns = { ...(config.builtIns || {}), [name]: enabled }
    setConfig({ ...config, builtIns })
    setBuiltIn(current => current.map(server => server.name === name ? { ...server, enabled } : server))
    setSaving(true)
    setError('')
    setNote('')
    try {
      const response = await fetch('/api/cc-mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servers: config.servers,
          builtIns,
          builtInPermissions: config.builtInPermissions,
        }),
      })
      const data = (await response.json()) as ApiPayload
      if (!response.ok || !data.ok || !data.config) throw new Error(data.error || '保存失败')
      setConfig(data.config)
      setBuiltIn(data.builtIn || [])
      setNote(enabled
        ? '内置 MCP 已启用；空闲窗口下一句话会加载顶层工具定义并继续原会话。'
        : '内置 MCP 已停用；空闲窗口下一句话会移除工具定义并继续原会话。')
    } catch (reason) {
      setConfig(previous)
      setBuiltIn(current => current.map(server => server.name === name ? { ...server, enabled: !enabled } : server))
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const setBuiltInPermission = async (name: string, permission: 'allow' | 'ask') => {
    const previous = config
    const previousBuiltIn = builtIn
    const builtInPermissions = { ...(config.builtInPermissions || {}), [name]: permission }
    setConfig({ ...config, builtInPermissions })
    setBuiltIn(current => current.map(server => server.name === name ? { ...server, permission } : server))
    setSaving(true)
    setError('')
    setNote('')
    try {
      const response = await fetch('/api/cc-mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          servers: config.servers,
          builtIns: config.builtIns,
          builtInPermissions,
        }),
      })
      const data = (await response.json()) as ApiPayload
      if (!response.ok || !data.ok || !data.config) throw new Error(data.error || '保存失败')
      setConfig(data.config)
      setBuiltIn(data.builtIn || [])
      setNote(permission === 'allow' ? '内置 MCP 已设为自动允许。' : '内置 MCP 已设为每次询问。')
    } catch (reason) {
      setConfig(previous)
      setBuiltIn(previousBuiltIn)
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    setError('')
    try {
      const server: CcMcpServer = {
        ...(config.servers.find(item => item.name === draft.originalName) || {}),
        name: draft.name.trim(),
        label: draft.label.trim() || draft.name.trim(),
        enabled: draft.enabled,
        transport: draft.transport,
        command: draft.transport === 'stdio' ? draft.command.trim() : undefined,
        args:
          draft.transport === 'stdio'
            ? draft.argsText.split('\n').map(item => item.trim()).filter(Boolean)
            : undefined,
        env:
          draft.transport === 'stdio'
            ? parseStringRecord(draft.envText, '环境变量')
            : undefined,
        url: draft.transport === 'stdio' ? undefined : draft.url.trim(),
        headers:
          draft.transport === 'stdio'
            ? undefined
            : parseStringRecord(draft.headersText, '请求 Headers'),
        timeout: draft.timeout ? Number(draft.timeout) : undefined,
        permission: draft.permission,
        toolPermissions: draft.toolPermissions,
        saveResults: draft.saveResults,
      }
      const next = draft.originalName
        ? config.servers.map(item => (item.name === draft.originalName ? server : item))
        : [...config.servers, server]
      await persist(
        next,
        draft.originalName ? 'MCP 已更新并读取工具。' : 'MCP 已新增并读取工具。',
        [server.name],
      )
      setDraft(null)
    } catch {
      // persist / JSON 解析已经把可读错误放进界面
    }
  }

  const toggleServer = async (name: string, enabled: boolean) => {
    const previous = config.servers
    const next = config.servers.map(server =>
      server.name === name ? { ...server, enabled } : server,
    )
    setConfig({ version: 1, builtIns: config.builtIns, builtInPermissions: config.builtInPermissions, servers: next })
    try {
      await persist(next, enabled ? 'MCP 已启用。' : 'MCP 已停用。')
    } catch {
      setConfig({ version: 1, builtIns: config.builtIns, builtInPermissions: config.builtInPermissions, servers: previous })
    }
  }

  const removeServer = async (name: string, label: string) => {
    if (!window.confirm(`删除 MCP「${label}」？保存的连接信息也会一起删除。`)) return
    try {
      await persist(config.servers.filter(server => server.name !== name), 'MCP 已删除。')
      setStatuses(current => current.filter(status => status.name !== name))
    } catch {
      /* 界面已显示错误 */
    }
  }

  const refreshTools = async () => {
    setChecking(true)
    setError('')
    try {
      const response = await fetch('/api/cc-mcp', { method: 'POST' })
      const data = (await response.json()) as ApiPayload
      if (!response.ok || !data.ok || !data.status || !data.config) {
        throw new Error(data.error || '工具清单读取失败')
      }
      setConfig(data.config)
      setStatuses(data.status.servers)
      const failed = data.status.servers.filter(server => server.status !== 'connected')
      setNote(
        failed.length
          ? `工具清单已同步；${failed.length} 个服务连接失败，原清单已保留。`
          : '已直接连接 MCP 并同步全部工具清单。',
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const changeToolPermission = async (
    serverName: string,
    toolName: string,
    permission: '' | CcMcpPermission,
  ) => {
    const next = config.servers.map(server => {
      if (server.name !== serverName) return server
      const toolPermissions = { ...(server.toolPermissions || {}) }
      if (permission) toolPermissions[toolName] = permission
      else delete toolPermissions[toolName]
      return { ...server, toolPermissions }
    })
    try {
      await persist(next, '工具权限已更新。')
    } catch {
      /* 界面已显示错误 */
    }
  }

  const changeToolEnabled = async (
    serverName: string,
    toolName: string,
    enabled: boolean,
  ) => {
    const previous = config.servers
    const next = config.servers.map(server =>
      server.name === serverName
        ? {
            ...server,
            tools: (server.tools || []).map(tool =>
              tool.name === toolName ? { ...tool, enabled } : tool,
            ),
          }
        : server,
    )
    setConfig({ version: 1, builtIns: config.builtIns, builtInPermissions: config.builtInPermissions, servers: next })
    try {
      await persist(
        next,
        enabled
          ? '工具已开启，说明与参数会从下一句话开始进入上下文。'
          : '工具已关闭，说明与参数会从下一句话开始移出上下文。',
      )
    } catch {
      setConfig({ version: 1, builtIns: config.builtIns, builtInPermissions: config.builtInPermissions, servers: previous })
    }
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">正在读取 MCP 配置…</p>
  }

  if (draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            ← 返回
          </button>
          <h3 className="text-base font-semibold text-[var(--color-text-heading)]">
            {draft.originalName ? '编辑 MCP' : '新增 MCP'}
          </h3>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">显示名称</span>
          <input
            className={INPUT}
            value={draft.label}
            onChange={event => {
              const label = event.target.value
              const previousGeneratedId = idFromLabel(draft.label)
              setDraft({
                ...draft,
                label,
                name:
                  !draft.originalName &&
                  (!draft.name || draft.name === previousGeneratedId)
                    ? idFromLabel(label)
                    : draft.name,
              })
            }}
            placeholder="例如 Ombre Brain"
          />
          <span className="mt-1 block text-[10px] text-[var(--color-text-disabled)]">
            只用于页面展示，可以随时修改。
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">内部 ID</span>
          <input
            className={`${INPUT} font-mono disabled:cursor-not-allowed disabled:bg-[var(--color-surface-secondary)] disabled:text-[var(--color-text-tertiary)]`}
            value={draft.name}
            disabled={Boolean(draft.originalName)}
            onChange={event =>
              setDraft({ ...draft, name: idFromLabel(event.target.value) })
            }
            placeholder="例如 ombre_brain"
          />
          <span className="mt-1 block text-[10px] text-[var(--color-text-disabled)]">
            {draft.originalName
              ? '工具会使用这个固定标识；保存后不可修改。'
              : '自动生成，只使用小写字母、数字和下划线。保存后不可修改。'}
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">连接方式</span>
            <select
              className={INPUT}
              value={draft.transport}
              onChange={event =>
                setDraft({ ...draft, transport: event.target.value as CcMcpTransport })
              }
            >
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">本机命令（stdio）</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">默认权限</span>
            <select
              className={INPUT}
              value={draft.permission}
              onChange={event =>
                setDraft({ ...draft, permission: event.target.value as CcMcpPermission })
              }
            >
              <option value="allow">自动允许</option>
              <option value="ask">每次询问</option>
              <option value="deny">禁止</option>
            </select>
          </label>
        </div>

        {draft.transport === 'stdio' ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">启动命令</span>
              <input
                className={INPUT}
                value={draft.command}
                onChange={event => setDraft({ ...draft, command: event.target.value })}
                placeholder="node / npx / 可执行文件绝对路径"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">参数（每行一个）</span>
              <textarea
                className={`${INPUT} min-h-24 font-mono text-xs`}
                value={draft.argsText}
                onChange={event => setDraft({ ...draft, argsText: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">环境变量（JSON）</span>
              <textarea
                className={`${INPUT} min-h-28 font-mono text-xs`}
                value={draft.envText}
                onChange={event => setDraft({ ...draft, envText: event.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">URL</span>
              <input
                className={INPUT}
                value={draft.url}
                onChange={event => setDraft({ ...draft, url: event.target.value })}
                placeholder="https://example.com/mcp"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">请求 Headers（JSON）</span>
              <textarea
                className={`${INPUT} min-h-28 font-mono text-xs`}
                value={draft.headersText}
                onChange={event => setDraft({ ...draft, headersText: event.target.value })}
              />
            </label>
          </>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">单次工具超时（毫秒，可留空）</span>
          <input
            className={INPUT}
            inputMode="numeric"
            value={draft.timeout}
            onChange={event => setDraft({ ...draft, timeout: event.target.value.replace(/\D/g, '') })}
            placeholder="例如 30000"
          />
        </label>

        <div className="grid gap-2 rounded-xl border border-[var(--color-border)] bg-white/60 p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={event => setDraft({ ...draft, enabled: event.target.checked })}
            />
            保存后启用
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={draft.saveResults}
              onChange={event => setDraft({ ...draft, saveResults: event.target.checked })}
            />
            在聊天历史里保留工具结果
          </label>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveDraft()}
            className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存并立即应用'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text-heading)]">MCP 服务</h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--color-text-tertiary)]">
            闲聊模式只保留这里启用的日常工具；工作模式会同时保留文件和命令工具。
            只有开启工具的说明和参数会固定放在对话消息之前。密钥只存本机服务端，
            页面重新打开只会看到遮罩。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={checking || saving}
            onClick={() => void refreshTools()}
            className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text-secondary)] disabled:opacity-50"
          >
            {checking ? '刷新中…' : '刷新工具清单'}
          </button>
          <button
            type="button"
            onClick={() => setDraft(emptyDraft())}
            className="rounded-xl bg-[var(--color-primary)] px-3 py-2 text-xs font-medium text-white"
          >
            + 新增 MCP
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)] px-4 py-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-disabled)]">
              下轮 MCP Context 预估
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-text-heading)]">
              {totalMcpTokens.toLocaleString()}{' '}
              <span className="text-xs font-normal text-[var(--color-text-tertiary)]">token</span>
            </div>
          </div>
          <div className="max-w-[15rem] text-right text-[10px] leading-relaxed text-[var(--color-text-disabled)]">
            按已开启工具的名称、说明和参数结构估算；开关后立即变化，下一句话生效。
            {missingSchemaCount ? ` 还有 ${missingSchemaCount} 个工具缺参数结构，请刷新工具清单。` : ''}
          </div>
        </div>
      </div>

      {note && (
        <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-700">
          {note}
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
          {error}
        </p>
      )}

      {builtIn.length > 0 && (
        <section className="mb-5 space-y-3">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Dashboard 内置 MCP</h4>
            <p className="mt-1 text-[10px] text-[var(--color-text-disabled)]">由 Dashboard 进程直接提供，不需要 URL 或启动命令。</p>
          </div>
          {builtIn.map(server => {
            const tokens = server.enabled
              ? server.tools.reduce((sum, tool) => sum + estimateMcpToolTokens(tool), 0)
              : 0
            return (
              <article key={server.name} className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <label className="mt-0.5 flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={saving}
                      onChange={event => void toggleBuiltIn(server.name, event.target.checked)}
                      aria-label={`${server.enabled ? '停用' : '启用'} ${server.label}`}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-[var(--color-text-heading)]">{server.label}</h4>
                      <span className="font-mono text-[10px] text-[var(--color-text-disabled)]">{server.name}</span>
                      <span className="rounded-full bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">内置 · 无链接</span>
                      {server.permissionConfigurable ? (
                        <select
                          className="rounded-full border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px] text-[var(--color-primary)] outline-none"
                          value={server.permission}
                          disabled={saving || !server.enabled}
                          onChange={event => void setBuiltInPermission(server.name, event.target.value as 'allow' | 'ask')}
                          aria-label={`${server.label} 权限`}
                        >
                          <option value="allow">自动允许</option>
                          <option value="ask">每次询问</option>
                        </select>
                      ) : (
                        <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] text-[var(--color-primary)]">自动允许</span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                      v{server.version} · {server.tools.length} 个工具 · {server.enabled ? `预估 ${tokens.toLocaleString()} token` : `开启后约 ${server.tools.reduce((sum, tool) => sum + estimateMcpToolTokens(tool), 0).toLocaleString()} token`}
                    </p>
                  </div>
                </div>
                <details className="group mt-3 border-t border-[var(--color-border-light)] pt-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] [&::-webkit-details-marker]:hidden">
                    顶层工具定义
                    <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {server.tools.map(tool => (
                      <div key={tool.name} className="rounded-xl bg-[var(--color-surface-secondary)] px-3 py-2.5">
                        <div className="font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">{shortToolName(tool.name)}</div>
                        <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-[10px] leading-relaxed text-[var(--color-text-tertiary)]">{toolDisplayDescription(tool)}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            )
          })}
        </section>
      )}

      <div className="space-y-3">
        {config.servers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-5 py-10 text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">还没有外部 MCP 服务</p>
            <p className="mt-1 text-xs text-[var(--color-text-disabled)]">内置 MCP 可直接使用；外部服务新增后会同步到正在运行的聊天窗口。</p>
          </div>
        )}

        {config.servers.map(server => {
          const status = statusByName.get(server.name)
          const tools = server.tools || []
          const enabledCount = tools.filter(tool => tool.enabled).length
          const serverTokens = estimateMcpServerTokens(server)
          const serverShare = totalMcpTokens > 0 ? serverTokens / totalMcpTokens * 100 : 0
          return (
            <article
              key={server.name}
              className="rounded-2xl border border-[var(--color-border)] bg-white/80 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-3">
                <label className="mt-0.5 flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    disabled={saving}
                    onChange={event => void toggleServer(server.name, event.target.checked)}
                    aria-label={`${server.enabled ? '停用' : '启用'} ${server.label}`}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-[var(--color-text-heading)]">
                      {server.label}
                    </h4>
                    <span className="font-mono text-[10px] text-[var(--color-text-disabled)]">
                      {server.name}
                    </span>
                    <span className="rounded-full bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                      {server.transport.toUpperCase()}
                    </span>
                    <span className="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] text-[var(--color-primary)]">
                      {permissionLabel(server.permission)}
                    </span>
                    {status && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          status.status === 'connected'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {statusLabel(status.status)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-disabled)]">
                    {server.transport === 'stdio'
                      ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
                      : server.url}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                    {server.saveResults ? '保留 MCP 返回结果' : '不保存返回结果'}
                    {tools.length ? ` · 已开启 ${enabledCount}/${tools.length} 个工具` : ''}
                    {` · 预估 ${serverTokens.toLocaleString()} token · MCP ${serverShare.toFixed(0)}%`}
                    {server.lastSyncedAt
                      ? ` · 最近同步 ${new Date(server.lastSyncedAt).toLocaleString('zh-CN')}`
                      : ''}
                    {status?.error ? ` · ${status.error}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft(draftFromServer(server))}
                    className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeServer(server.name, server.label)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
              </div>

              {tools.length > 0 ? (
                <details className="group mt-3 border-t border-[var(--color-border-light)] pt-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)] [&::-webkit-details-marker]:hidden">
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      工具与权限
                    </span>
                    <span className="flex items-center gap-2 text-[10px]">
                      已开启 {enabledCount}/{tools.length}
                      <span
                        aria-hidden="true"
                        className="inline-block text-xs transition-transform group-open:rotate-180"
                      >
                        ⌄
                      </span>
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {tools.map(tool => {
                      const toolTokens = estimateMcpToolTokens(tool)
                      const toolShare = totalMcpTokens > 0 && server.enabled && tool.enabled
                        ? toolTokens / totalMcpTokens * 100
                        : 0
                      return (
                      <div
                        key={tool.name}
                        className={`rounded-xl px-3 py-2.5 transition ${
                          tool.enabled
                            ? 'bg-[var(--color-surface-secondary)]'
                            : 'bg-black/[0.025] opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <label className="relative inline-flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={tool.enabled}
                              disabled={saving}
                              onChange={event =>
                                void changeToolEnabled(
                                  server.name,
                                  tool.name,
                                  event.target.checked,
                                )
                              }
                              aria-label={`${tool.enabled ? '关闭' : '开启'} ${shortToolName(tool.name)}`}
                            />
                            <span className="h-5 w-9 rounded-full bg-black/10 transition peer-checked:bg-[var(--color-primary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-4" />
                          </label>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">
                                {tool.title || shortToolName(tool.name)}
                              </span>
                              {tool.destructive && (
                                <span className="text-[9px] text-red-600">可能有破坏性</span>
                              )}
                              {tool.openWorld && (
                                <span className="text-[9px] text-amber-700">访问外部</span>
                              )}
                              <span className="text-[9px] tabular-nums text-[var(--color-text-disabled)]">
                                {server.enabled && tool.enabled
                                  ? `预估 ${toolTokens.toLocaleString()} token · MCP ${toolShare.toFixed(1)}%`
                                  : `开启后约 ${toolTokens.toLocaleString()} token`}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-[var(--color-text-tertiary)]">
                              {toolDisplayDescription(tool)}
                            </p>
                          </div>
                          <select
                            className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[10px]"
                            value={server.toolPermissions?.[tool.name] || ''}
                            disabled={saving || !tool.enabled}
                            onChange={event =>
                              void changeToolPermission(
                                server.name,
                                tool.name,
                                event.target.value as '' | CcMcpPermission,
                              )
                            }
                          >
                            <option value="">跟随服务（{permissionLabel(server.permission)}）</option>
                            <option value="allow">自动允许</option>
                            <option value="ask">每次询问</option>
                            <option value="deny">禁止</option>
                          </select>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </details>
              ) : (
                <p className="mt-3 border-t border-[var(--color-border-light)] pt-3 text-[10px] text-[var(--color-text-disabled)]">
                  尚未读取工具。编辑并保存，或点击“刷新工具清单”连接这个 MCP。
                </p>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
