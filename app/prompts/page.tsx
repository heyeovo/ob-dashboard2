'use client'

import { useEffect, useState } from 'react'
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
                <textarea value={editing[name] || ''} onChange={e => setEditing(prev => ({ ...prev, [name]: e.target.value }))}
                  rows={Math.max(7, (editing[name] || '').split('\n').length + 2)}
                  className="w-full mt-4 text-xs font-mono bg-[#FAFAF8] border border-[var(--color-border-subtle)] rounded-lg p-3 outline-none focus:border-[var(--color-primary)] resize-y leading-relaxed" />
                <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">{(editing[name] || '').length} 字符</div>
              </div>}
            </Card>
          })}
        </div>
      </main>
      {testName && prompts[testName] && <TestModal item={prompts[testName]} draft={editing[testName] || ''} onClose={() => setTestName(null)} />}
    </div>
  )
}
