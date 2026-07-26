'use client'
import { useState, useEffect } from 'react'
import DetailPanel from '../components/DetailPanel'
import Card from '../components/Card'

const PROMPT_LABELS: Record<string, string> = {
  dehydrate: '脱水压缩',
  analyze: '自动打标',
}

function TestModal({ name, label, currentPrompt, onClose }: {
  name: string; label: string; currentPrompt: string; onClose: () => void
}) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!input.trim()) return
    setRunning(true); setError(''); setResult('')
    try {
      const res = await fetch('/api/prompts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: input, prompt_override: currentPrompt }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error) } else {
        const raw = data.result
        const display = typeof raw === 'string'
          ? (() => { try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw } })()
          : JSON.stringify(raw, null, 2)
        setResult(display)
      }
    } catch (e) { setError(String(e)) }
    finally { setRunning(false) }
  }

  return (
    <DetailPanel open={true} onClose={onClose} mode="modal" width="max-w-6xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">测试 · {label}</span>
            <span className="text-[10px] text-[var(--color-text-disabled)] font-mono">{name}</span>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] text-xl leading-none transition-colors">×</button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col sm:flex-row min-h-0 min-h-[400px]">
          {/* 左格：原文 */}
          <div className="flex-1 flex flex-col min-h-0 border-b sm:border-b-0 sm:border-r border-[var(--color-border)]">
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#FEF3EE] flex-shrink-0">
              <span className="text-xs font-medium text-[#C86B45]">原文</span>
              <span className="text-[10px] text-[var(--color-primary)] font-mono">{input.length} 字 · ~{Math.ceil(input.length * 1.3)} tokens</span>
            </div>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="粘贴要测试的原始内容…"
              className="flex-1 w-full text-xs text-[var(--color-text-primary)] p-4 outline-none resize-none font-mono leading-relaxed placeholder:text-[#C0BBB5]"
            />
          </div>

          {/* 右格：结果 */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#FEF3EE] flex-shrink-0">
              <span className="text-xs font-medium text-[#C86B45]">
                {name === 'dehydrate' ? '脱水结果' : '打标结果'}
              </span>
              <span className="text-[10px] text-[var(--color-primary)] font-mono">{result.length} 字 · ~{Math.ceil(result.length * 1.3)} tokens</span>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[#FAFAF8]">
              {error && <p className="text-xs text-red-500">{error}</p>}
              {result && <pre className="text-xs text-[var(--color-text-primary)] font-mono whitespace-pre-wrap leading-relaxed">{result}</pre>}
              {!result && !error && <p className="text-xs text-[#C0BBB5]">点击运行后显示结果…</p>}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="text-xs px-4 py-2 border border-[var(--color-border)] text-[var(--color-text-tertiary)] rounded-lg hover:bg-[var(--color-surface-secondary)] transition-colors">关闭</button>
          <button onClick={run} disabled={!input.trim() || running}
            className="text-xs px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)] disabled:opacity-40 transition-colors">
            {running ? '运行中…' : '▶\uFE0E 运行'}
          </button>
        </div>
    </DetailPanel>
  )
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [testModal, setTestModal] = useState<string | null>(null)

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('ombra_prompts')
      if (cached) {
        const parsed = JSON.parse(cached)
        setPrompts(parsed); setEditing(parsed); setLoading(false)
      }
    } catch {}
    fetch('/api/prompts')
      .then(r => r.json())
      .then(d => {
        setPrompts(d); setEditing(d)
        try { sessionStorage.setItem('ombra_prompts', JSON.stringify(d)) } catch {}
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async (name: string) => {
    setSaving(name)
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: editing[name] }),
      })
      const data = await res.json()
      if (data.ok) {
        setPrompts(prev => ({ ...prev, [name]: editing[name] }))
        setSaved(name); setTimeout(() => setSaved(null), 2000)
      }
    } finally { setSaving(null) }
  }

  const reset = (name: string) => setEditing(prev => ({ ...prev, [name]: prompts[name] }))
  const isDirty = (name: string) => editing[name] !== prompts[name]
  const toggleCollapse = (name: string) => setCollapsed(prev => ({ ...prev, [name]: !prev[name] }))

  if (loading) return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
      <div className="text-sm text-[var(--color-text-tertiary)]">加载中…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans pb-20">

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        <div className="hidden md:block mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[var(--color-text-heading)] mb-2 sm:mb-3">Prompt 配置</h1>
          <p className="text-[var(--color-text-tertiary)] text-xs sm:text-sm">修改后立即生效 · 重启后恢复默认</p>
        </div>
        <div className="md:hidden mb-4">
          <h1 className="text-xl font-bold text-[var(--color-text-heading)]">Prompt 配置</h1>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">修改后立即生效 · 重启后恢复默认</p>
        </div>

        <div className="space-y-4">
          {Object.keys(PROMPT_LABELS).map(name => (
            <Card key={name} variant="outline" padding="none" className="overflow-hidden">
              <div
                className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-4 cursor-pointer select-none hover:bg-[#FAFAF8] transition-colors"
                onClick={() => toggleCollapse(name)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{PROMPT_LABELS[name]}</span>
                  <span className="text-[10px] text-[var(--color-text-disabled)] font-mono">{name}</span>
                  {isDirty(name) && <span className="text-[10px] text-[var(--color-primary)]">未保存</span>}
                  {saved === name && <span className="text-[10px] text-[var(--color-digested)]">已保存 ✓</span>}
                </div>
                <div className="flex gap-2 items-center mt-2 sm:mt-0 self-end sm:self-auto"
                  onClick={e => e.stopPropagation()}>
                  <button onClick={() => setTestModal(name)}
                    className="text-xs px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-tertiary)] rounded-lg hover:bg-[var(--color-surface-secondary)] transition-colors">
                    测 试
                  </button>
                  {isDirty(name) && (
                    <button onClick={() => reset(name)}
                      className="text-xs px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-tertiary)] rounded-lg hover:bg-[var(--color-surface-secondary)] transition-colors">
                      还原
                    </button>
                  )}
                  <button onClick={() => save(name)} disabled={!isDirty(name) || saving === name}
                    className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)] disabled:opacity-40 transition-colors">
                    {saving === name ? '保存中…' : '应用到后端'}
                  </button>
                  <span className="text-[#C0BBB5] text-xs ml-1 pointer-events-none">
                    {collapsed[name] ? '▾' : '▴'}
                  </span>
                </div>
              </div>

              {!collapsed[name] && (
                <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-[var(--color-border-light)]">
                  <textarea
                    value={editing[name] ?? ''}
                    onChange={e => setEditing(prev => ({ ...prev, [name]: e.target.value }))}
                    className="w-full mt-4 text-xs font-mono text-[var(--color-text-primary)] bg-[#FAFAF8] border border-[var(--color-border-subtle)] rounded-lg p-3 outline-none focus:border-[var(--color-primary)] resize-none leading-relaxed"
                    rows={Math.max(10, (editing[name] ?? '').split('\n').length + 2)}
                  />
                  <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">
                    {(editing[name] ?? '').length} 字符
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      </main>

      {testModal && (
        <TestModal
          name={testModal}
          label={PROMPT_LABELS[testModal]}
          currentPrompt={editing[testModal] ?? ''}
          onClose={() => setTestModal(null)}
        />
      )}
    </div>
  )
}