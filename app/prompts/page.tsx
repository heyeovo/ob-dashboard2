'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '../components/Card'
import DetailPanel from '../components/DetailPanel'

type PromptItem = {
  name: string
  content: string
  default_content: string
  customized: boolean
  source: 'system_default' | 'user_override'
  revision: number
  updated_at: string
  test_supported: boolean
  runtime_layers: string[]
  model_hard_constraints: string
  server_validations: string[]
}

type WakePromptConfig = {
  instructions: string
  tool_description: string
  default_instructions: string
  default_tool_description: string
  customized: boolean
  updated_at: string
}

const PROMPT_META: Record<string, { label: string; description: string }> = {
  analyze: { label: '自动打标', description: '调整标签、标题、分类和情绪判断的关注重点' },
  merge: { label: '记忆合并', description: '调整新旧记忆合并时的文风、篇幅和保留重点' },
  daily_review: { label: '独立日回顾', description: '调整每天写给明天自己的回顾语气和关注重点' },
  weekly_journey: { label: '每周关系轨迹', description: '调整关系阶段候选的文风、判断尺度和篇幅' },
}

function displayResult(raw: unknown) {
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2)
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function TestModal({ item, draft, onClose }: { item: PromptItem; draft: string; onClose: () => void }) {
  const [sample, setSample] = useState('')
  const [newContent, setNewContent] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const isMerge = item.name === 'merge'

  const run = async () => {
    if (!sample.trim() || (isMerge && !newContent.trim())) return
    setRunning(true); setError(''); setResult('')
    try {
      const body = isMerge
        ? { name: item.name, content: draft, old_content: sample, new_content: newContent }
        : { name: item.name, content: draft, sample_input: sample }
      const res = await fetch('/api/prompts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `测试失败（${res.status}）`)
      setResult(displayResult(data.result))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <DetailPanel open onClose={onClose} mode="modal" width="max-w-6xl">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">安全测试 · {PROMPT_META[item.name].label}</div>
          <div className="text-[10px] text-[var(--color-text-disabled)] mt-1">只使用当前草稿试跑，不保存、不修改正式运行实例</div>
        </div>
        <button onClick={onClose} className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] text-xl">×</button>
      </div>
      <div className="grid sm:grid-cols-2 min-h-[420px]">
        <div className="flex flex-col border-b sm:border-b-0 sm:border-r border-[var(--color-border)]">
          <div className="px-4 py-2.5 bg-[#FEF3EE] text-xs font-medium text-[#C86B45]">
            {isMerge ? '旧记忆' : '测试原文'}
          </div>
          <textarea value={sample} onChange={e => setSample(e.target.value)}
            placeholder={isMerge ? '粘贴一段旧记忆…' : '粘贴要测试的记忆正文…'}
            className="min-h-40 flex-1 p-4 text-xs font-mono outline-none resize-none" />
          {isMerge && <>
            <div className="px-4 py-2.5 bg-[#FEF3EE] text-xs font-medium text-[#C86B45] border-t border-[var(--color-border)]">新内容</div>
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="粘贴准备合入的新内容…"
              className="min-h-40 flex-1 p-4 text-xs font-mono outline-none resize-none" />
          </>}
        </div>
        <div className="flex flex-col bg-[#FAFAF8]">
          <div className="px-4 py-2.5 bg-[#FEF3EE] text-xs font-medium text-[#C86B45]">试跑结果</div>
          <div className="flex-1 overflow-auto p-4">
            {error && <p className="text-xs text-red-500">{error}</p>}
            {result && <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">{result}</pre>}
            {!result && !error && <p className="text-xs text-[#C0BBB5]">试跑结果不会写入记忆或 Prompt 配置。</p>}
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
        <button onClick={onClose} className="text-xs px-4 py-2 border border-[var(--color-border)] rounded-lg">关闭</button>
        <button onClick={run} disabled={!sample.trim() || (isMerge && !newContent.trim()) || running}
          className="text-xs px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-40">
          {running ? '运行中…' : '运行测试'}
        </button>
      </div>
    </DetailPanel>
  )
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Record<string, PromptItem>>({})
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Record<string, { type: 'ok' | 'error'; text: string }>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [testName, setTestName] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setLoadError('')
    try {
      const res = await fetch('/api/prompts', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.prompts) throw new Error(data.error || 'Prompt 配置加载失败')
      setPrompts(data.prompts)
      setEditing(Object.fromEntries(Object.entries(data.prompts as Record<string, PromptItem>).map(([name, item]) => [name, item.content])))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const updateItem = (item: PromptItem) => {
    setPrompts(prev => ({ ...prev, [item.name]: item }))
    setEditing(prev => ({ ...prev, [item.name]: item.content }))
  }

  const save = async (name: string) => {
    const content = (editing[name] || '').trim()
    if (!content) {
      setMessage(prev => ({ ...prev, [name]: { type: 'error', text: '正文不能为空' } }))
      return
    }
    setBusy(name); setMessage(prev => ({ ...prev, [name]: { type: 'ok', text: '' } }))
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, expected_revision: prompts[name].revision }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.code === 'revision_conflict' ? '配置已在别处变化，请刷新后再编辑' : data.error || '保存失败')
      updateItem(data.prompt)
      setMessage(prev => ({ ...prev, [name]: { type: 'ok', text: '已保存并立即生效' } }))
    } catch (e) {
      setMessage(prev => ({ ...prev, [name]: { type: 'error', text: e instanceof Error ? e.message : String(e) } }))
    } finally { setBusy(null) }
  }

  const restoreDefault = async (name: string) => {
    if (!window.confirm(`恢复“${PROMPT_META[name].label}”的系统默认版本？`)) return
    setBusy(name)
    try {
      const res = await fetch('/api/prompts/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expected_revision: prompts[name].revision }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.code === 'revision_conflict' ? '配置已在别处变化，请刷新后再操作' : data.error || '恢复默认失败')
      updateItem(data.prompt)
      setMessage(prev => ({ ...prev, [name]: { type: 'ok', text: '已恢复系统默认并立即生效' } }))
    } catch (e) {
      setMessage(prev => ({ ...prev, [name]: { type: 'error', text: e instanceof Error ? e.message : String(e) } }))
    } finally { setBusy(null) }
  }

  if (loading) return <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center text-sm text-[var(--color-text-tertiary)]">加载中…</div>
  if (loadError) return <div className="min-h-screen bg-[var(--color-bg)] flex flex-col gap-3 items-center justify-center text-sm text-red-500"><span>{loadError}</span><button onClick={load} className="px-4 py-2 border rounded-lg text-[var(--color-text-primary)]">重新加载</button></div>

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] pb-20">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-4xl font-bold tracking-tight text-[var(--color-text-heading)]">Prompt 配置</h1>
          <p className="text-[var(--color-text-tertiary)] text-xs sm:text-sm mt-2">由 Haven 持久保存 · 保存后立即生效 · 重启和重新部署后继续保留</p>
          <p className="text-[11px] text-[var(--color-text-disabled)] mt-1">这里只调整文风、关注重点、判断尺度和篇幅；结构协议、证据边界与写入安全规则不可覆盖。</p>
        </div>

        <div className="space-y-4">
          {Object.keys(PROMPT_META).map(name => {
            const item = prompts[name]
            if (!item) return null
            const dirty = editing[name] !== item.content
            const note = message[name]
            return <Card key={name} variant="outline" padding="none" className="overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-4">
                <button className="text-left flex-1" onClick={() => setCollapsed(prev => ({ ...prev, [name]: !prev[name] }))}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{PROMPT_META[name].label}</span>
                    <span className="text-[10px] font-mono text-[var(--color-text-disabled)]">{name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.customized ? 'bg-[#FEF3EE] text-[#C86B45]' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]'}`}>
                      {item.customized ? '用户自定义' : '系统默认'}
                    </span>
                    {dirty && <span className="text-[10px] text-[var(--color-primary)]">未保存</span>}
                  </div>
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{PROMPT_META[name].description}</p>
                  {item.updated_at && <p className="text-[10px] text-[var(--color-text-disabled)] mt-1">更新于 {item.updated_at}</p>}
                </button>
                <div className="flex gap-2 flex-wrap items-center">
                  {item.test_supported && <button onClick={() => setTestName(name)} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-lg">测试</button>}
                  {dirty && <button onClick={() => setEditing(prev => ({ ...prev, [name]: item.content }))} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-lg">还原未保存修改</button>}
                  {item.customized && <button onClick={() => restoreDefault(name)} disabled={busy === name} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-lg disabled:opacity-40">恢复系统默认</button>}
                  <button onClick={() => save(name)} disabled={!dirty || busy === name} className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-40">{busy === name ? '处理中…' : '保存并生效'}</button>
                  <button onClick={() => setCollapsed(prev => ({ ...prev, [name]: !prev[name] }))} className="text-xs text-[#C0BBB5]">{collapsed[name] ? '▾' : '▴'}</button>
                </div>
              </div>
              {note?.text && <div className={`px-4 sm:px-6 pb-3 text-xs ${note.type === 'error' ? 'text-red-500' : 'text-[var(--color-digested)]'}`}>{note.text}</div>}
              {!collapsed[name] && <div className="px-4 sm:px-6 pb-5 border-t border-[var(--color-border-light)]">
                <div className="mt-4 mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-[var(--color-text-primary)]">可编辑的产品提示词</div>
                    <div className="text-[10px] text-[var(--color-text-disabled)] mt-0.5">控制文风、关注重点、判断尺度和篇幅</div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FEF3EE] text-[#C86B45]">可编辑</span>
                </div>
                <textarea value={editing[name] || ''} onChange={e => setEditing(prev => ({ ...prev, [name]: e.target.value }))}
                  rows={Math.max(7, (editing[name] || '').split('\n').length + 2)}
                  className="w-full text-xs font-mono bg-[#FAFAF8] border border-[var(--color-border-subtle)] rounded-lg p-3 outline-none focus:border-[var(--color-primary)] resize-y leading-relaxed" />
                <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">{(editing[name] || '').length} 字符</div>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] p-3.5">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-xs font-medium text-[var(--color-text-primary)]">运行时自动叠加</div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-[var(--color-text-tertiary)] border border-[var(--color-border)]">只读</span>
                    </div>
                    <ul className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
                      {(item.runtime_layers || []).map((line, index) => <li key={index} className="flex gap-2"><span>•</span><span>{line}</span></li>)}
                    </ul>
                  </div>

                  <details open className="rounded-lg border border-[var(--color-border-subtle)] bg-[#F7F7F5] overflow-hidden">
                    <summary className="cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-[var(--color-text-primary)]">模型不可覆盖的固定约束</div>
                        <div className="text-[10px] text-[var(--color-text-disabled)] mt-0.5">实际发送给模型，始终生效，不会被上方内容覆盖</div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-[var(--color-text-tertiary)] border border-[var(--color-border)]">只读</span>
                    </summary>
                    <pre className="mx-3.5 mb-3.5 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-white border border-[var(--color-border-light)] p-3 text-[11px] font-mono leading-relaxed text-[var(--color-text-tertiary)]">{item.model_hard_constraints}</pre>
                  </details>

                  <details open className="rounded-lg border border-[var(--color-border-subtle)] bg-[#F7F7F5] overflow-hidden">
                    <summary className="cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-[var(--color-text-primary)]">模型返回后的服务端校验</div>
                        <div className="text-[10px] text-[var(--color-text-disabled)] mt-0.5">这些不是 Prompt 文字，而是 Haven 程序继续执行的安全边界</div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-[var(--color-text-tertiary)] border border-[var(--color-border)]">只读</span>
                    </summary>
                    <ul className="mx-3.5 mb-3.5 space-y-1.5 rounded-md bg-white border border-[var(--color-border-light)] p-3 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
                      {(item.server_validations || []).map((line, index) => <li key={index} className="flex gap-2"><span>•</span><span>{line}</span></li>)}
                    </ul>
                  </details>
                </div>
              </div>}
            </Card>
          })}
        </div>
        <AgentWakePromptSection />
      </main>
      {testName && prompts[testName] && <TestModal item={prompts[testName]} draft={editing[testName] || ''} onClose={() => setTestName(null)} />}
    </div>
  )
}

function AgentWakePromptSection() {
  const [config, setConfig] = useState<WakePromptConfig | null>(null)
  const [instructions, setInstructions] = useState('')
  const [toolDesc, setToolDesc] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cc-agent-wake-prompt', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.config) throw new Error(data.error || '读取失败')
      setConfig(data.config)
      setInstructions(data.config.instructions)
      setToolDesc(data.config.tool_description)
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!instructions.trim() || !toolDesc.trim()) {
      setMessage({ type: 'error', text: '提示词和工具描述不能为空' })
      return
    }
    setBusy(true); setMessage(null)
    try {
      const res = await fetch('/api/cc-agent-wake-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: instructions.trim(), tool_description: toolDesc.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      setConfig(data.config)
      setInstructions(data.config.instructions)
      setToolDesc(data.config.tool_description)
      setMessage({ type: 'ok', text: '已保存，下一次唤醒生效' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!window.confirm('恢复主动唤醒提示词的系统默认版本？')) return
    setBusy(true); setMessage(null)
    try {
      const res = await fetch('/api/cc-agent-wake-prompt', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '恢复失败')
      setConfig(data.config)
      setInstructions(data.config.instructions)
      setToolDesc(data.config.tool_description)
      setMessage({ type: 'ok', text: '已恢复系统默认' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null
  if (!config) return null

  const dirtyInstructions = instructions !== config.instructions
  const dirtyToolDesc = toolDesc !== config.tool_description
  const dirty = dirtyInstructions || dirtyToolDesc

  return (
    <div className="mt-10 border-t border-[var(--color-border)] pt-8">
      <div className="mb-4">
        <h2 className="text-lg sm:text-2xl font-bold tracking-tight text-[var(--color-text-heading)]">CC 引擎提示词</h2>
        <p className="text-[var(--color-text-tertiary)] text-xs sm:text-sm mt-1">Dashboard 本地存储 · 保存后下次唤醒生效</p>
      </div>
      <Card variant="outline" padding="none" className="overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-4">
          <button className="text-left flex-1" onClick={() => setCollapsed(!collapsed)}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">主动唤醒</span>
              <span className="text-[10px] font-mono text-[var(--color-text-disabled)]">agent_wake_instructions</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${config.customized ? 'bg-[#FEF3EE] text-[#C86B45]' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)]'}`}>
                {config.customized ? '用户自定义' : '系统默认'}
              </span>
              {dirty && <span className="text-[10px] text-[var(--color-primary)]">未保存</span>}
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">醒来时的 MCP 指引和工具描述，影响唤醒行为和 thinking 语言</p>
            {config.updated_at && <p className="text-[10px] text-[var(--color-text-disabled)] mt-1">更新于 {config.updated_at}</p>}
          </button>
          <div className="flex gap-2 flex-wrap items-center">
            {dirty && <button onClick={() => { setInstructions(config.instructions); setToolDesc(config.tool_description) }} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-lg">还原未保存修改</button>}
            {config.customized && <button onClick={reset} disabled={busy} className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded-lg disabled:opacity-40">恢复系统默认</button>}
            <button onClick={save} disabled={!dirty || busy} className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-40">{busy ? '处理中…' : '保存并生效'}</button>
            <button onClick={() => setCollapsed(!collapsed)} className="text-xs text-[#C0BBB5]">{collapsed ? '▾' : '▴'}</button>
          </div>
        </div>
        {message && <div className={`px-4 sm:px-6 pb-3 text-xs ${message.type === 'error' ? 'text-red-500' : 'text-[var(--color-digested)]'}`}>{message.text}</div>}
        {!collapsed && <div className="px-4 sm:px-6 pb-5 border-t border-[var(--color-border-light)]">
          <div className="mt-4 mb-2">
            <div className="text-xs font-medium text-[var(--color-text-primary)]">MCP 指引</div>
            <div className="text-[10px] text-[var(--color-text-disabled)] mt-0.5">醒来时注入的行为引导，用中文写能让 thinking 也保持中文</div>
          </div>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
            rows={Math.max(6, instructions.split('\n').length + 2)}
            className="w-full text-xs font-mono bg-[#FAFAF8] border border-[var(--color-border-subtle)] rounded-lg p-3 outline-none focus:border-[var(--color-primary)] resize-y leading-relaxed" />
          <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">{instructions.length} 字符</div>

          <div className="mt-4 mb-2">
            <div className="text-xs font-medium text-[var(--color-text-primary)]">工具描述</div>
            <div className="text-[10px] text-[var(--color-text-disabled)] mt-0.5">set_agent_wake 工具的说明文字</div>
          </div>
          <textarea value={toolDesc} onChange={e => setToolDesc(e.target.value)}
            rows={Math.max(3, toolDesc.split('\n').length + 1)}
            className="w-full text-xs font-mono bg-[#FAFAF8] border border-[var(--color-border-subtle)] rounded-lg p-3 outline-none focus:border-[var(--color-primary)] resize-y leading-relaxed" />
          <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">{toolDesc.length} 字符</div>
        </div>}
      </Card>
    </div>
  )
}
