'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

const PROMPT_LABELS: Record<string, string> = {
  dehydrate: '脱水压缩',
  analyze: '自动打标',
}

function StatsBadge({ text }: { text: string }) {
  const chars = text.length
  const tokens = Math.ceil(chars * 1.3)
  return (
    <span className="text-[10px] text-[#C4896A] font-mono">
      {chars} 字 · ~{tokens} tokens
    </span>
  )
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E6E1]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#3A3836]">测试 · {label}</span>
            <span className="text-[10px] text-[#A8A49D] font-mono">{name}</span>
          </div>
          <button onClick={onClose} className="text-[#A8A49D] hover:text-[#3A3836] text-xl leading-none transition-colors">×</button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col sm:flex-row min-h-0 min-h-[400px]">
          {/* 左格：原文 */}
          <div className="flex-1 flex flex-col min-h-0 border-b sm:border-b-0 sm:border-r border-[#E8E6E1]">
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#FEF3EE] flex-shrink-0">
              <span className="text-xs font-medium text-[#C86B45]">原文</span>
              <StatsBadge text={input} />
            </div>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="粘贴要测试的原始内容…"
              className="flex-1 w-full text-xs text-[#3A3836] p-4 outline-none resize-none font-mono leading-relaxed placeholder:text-[#C0BBB5]"
            />
          </div>

          {/* 右格：结果 */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#FEF3EE] flex-shrink-0">
              <span className="text-xs font-medium text-[#C86B45]">
                {name === 'dehydrate' ? '脱水结果' : '打标结果'}
              </span>
              <StatsBadge text={result} />
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[#FAFAF8]">
              {error && <p className="text-xs text-red-500">{error}</p>}
              {result && <pre className="text-xs text-[#3A3836] font-mono whitespace-pre-wrap leading-relaxed">{result}</pre>}
              {!result && !error && <p className="text-xs text-[#C0BBB5]">点击运行后显示结果…</p>}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#E8E6E1] flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="text-xs px-4 py-2 border border-[#E8E6E1] text-[#8A8681] rounded-lg hover:bg-[#F9F8F6] transition-colors">关闭</button>
          <button onClick={run} disabled={!input.trim() || running}
            className="text-xs px-4 py-2 bg-[#D97757] text-white rounded-lg hover:bg-[#C86645] disabled:opacity-40 transition-colors">
            {running ? '运行中…' : '▶ 运行'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="min-h-screen bg-[#FCFAF8] flex items-center justify-center">
      <div className="text-sm text-[#8A8681]">加载中…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans pb-20">
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[#8A8681]">
          <Link href="/" className="text-[#3A3836] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-[#D97757] to-[#E8A58F]"></div>
            <span className="text-xs sm:text-sm">Ombre Brain</span>
          </Link>
          <Link href="/?tab=timeline" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">时间线</Link>
          <Link href="/?tab=grid" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">记忆格</Link>
          <Link href="/?tab=review" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">审阅</Link>
          <Link href="/breath-sim" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">模拟 Breath</Link>
          <Link href="/prompts" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[#3A3836] border-b-2 border-[#D97757]">权重配置</Link>
          <span className="hover:text-[#3A3836] cursor-pointer transition-colors ml-auto whitespace-nowrap">配置</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        <div className="hidden md:block mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[#2B2927] mb-2 sm:mb-3">Prompt 配置</h1>
          <p className="text-[#8A8681] text-xs sm:text-sm">修改后立即生效 · 重启后恢复默认</p>
        </div>
        <div className="md:hidden mb-4">
          <h1 className="text-xl font-bold text-[#2B2927]">Prompt 配置</h1>
          <p className="text-xs text-[#8A8681] mt-1">修改后立即生效 · 重启后恢复默认</p>
        </div>

        <div className="space-y-4">
          {Object.keys(PROMPT_LABELS).map(name => (
            <div key={name} className="bg-white border border-[#E8E6E1] rounded-2xl overflow-hidden">
              <div
                className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-4 cursor-pointer select-none hover:bg-[#FAFAF8] transition-colors"
                onClick={() => toggleCollapse(name)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[#3A3836]">{PROMPT_LABELS[name]}</span>
                  <span className="text-[10px] text-[#A8A49D] font-mono">{name}</span>
                  {isDirty(name) && <span className="text-[10px] text-[#D97757]">未保存</span>}
                  {saved === name && <span className="text-[10px] text-[#478B4A]">已保存 ✓</span>}
                </div>
                <div className="flex gap-2 items-center mt-2 sm:mt-0 self-end sm:self-auto"
                  onClick={e => e.stopPropagation()}>
                  <button onClick={() => setTestModal(name)}
                    className="text-xs px-3 py-1.5 border border-[#E8E6E1] text-[#8A8681] rounded-lg hover:bg-[#F9F8F6] transition-colors">
                    测 试
                  </button>
                  {isDirty(name) && (
                    <button onClick={() => reset(name)}
                      className="text-xs px-3 py-1.5 border border-[#E8E6E1] text-[#8A8681] rounded-lg hover:bg-[#F9F8F6] transition-colors">
                      还原
                    </button>
                  )}
                  <button onClick={() => save(name)} disabled={!isDirty(name) || saving === name}
                    className="text-xs px-3 py-1.5 bg-[#D97757] text-white rounded-lg hover:bg-[#C86645] disabled:opacity-40 transition-colors">
                    {saving === name ? '保存中…' : '应用到后端'}
                  </button>
                  <span className="text-[#C0BBB5] text-xs ml-1 pointer-events-none">
                    {collapsed[name] ? '▾' : '▴'}
                  </span>
                </div>
              </div>

              {!collapsed[name] && (
                <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-[#F0EFEB]">
                  <textarea
                    value={editing[name] ?? ''}
                    onChange={e => setEditing(prev => ({ ...prev, [name]: e.target.value }))}
                    className="w-full mt-4 text-xs font-mono text-[#3A3836] bg-[#FAFAF8] border border-[#EEEAE4] rounded-lg p-3 outline-none focus:border-[#D97757] resize-none leading-relaxed"
                    rows={Math.max(10, (editing[name] ?? '').split('\n').length + 2)}
                  />
                  <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">
                    {(editing[name] ?? '').length} 字符
                  </div>
                </div>
              )}
            </div>
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