'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

const PROMPT_LABELS: Record<string, string> = {
  dehydrate: '脱水压缩',
  analyze: '自动打标',
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)


  useEffect(() => {
  // 先尝试从 sessionStorage 恢复缓存（仅在客户端）
  try {
    const cached = sessionStorage.getItem('ombra_prompts')
    if (cached) {
      const parsed = JSON.parse(cached)
      setPrompts(parsed)
      setEditing(parsed)
      setLoading(false)
    }
  } catch {}

  // 后台请求最新数据
  fetch('/api/prompts')
    .then(r => r.json())
    .then(d => {
      setPrompts(d)
      setEditing(d)
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
        setSaved(name)
        setTimeout(() => setSaved(null), 2000)
      }
    } finally {
      setSaving(null)
    }
  }

  const reset = (name: string) => setEditing(prev => ({ ...prev, [name]: prompts[name] }))
  const isDirty = (name: string) => editing[name] !== prompts[name]

  if (loading) return (
    <div className="min-h-screen bg-[#FCFAF8] flex items-center justify-center">
      <div className="text-sm text-[#8A8681]">加载中…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans pb-20">

      {/* 顶部导航 —— 与主页一致的多页面切换样式 */}
      <nav className="border-b border-[#E8E6E1] bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[#8A8681]">
          <Link href="/" className="text-[#3A3836] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-[#D97757] to-[#E8A58F]"></div>
            <span className="text-xs sm:text-sm">Ombre Brain</span>
          </Link>
          <Link href="/?tab=timeline" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">
            时间线
          </Link>
          <Link href="/?tab=grid" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">
            记忆格
          </Link>
          <Link href="/?tab=review" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">
            审阅
          </Link>
          <Link href="/breath-sim" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap hover:text-[#3A3836]">
            模拟 Breath
          </Link>
          <Link href="/prompts" className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[#3A3836] border-b-2 border-[#D97757]">
            权重配置
          </Link>
          <span className="hover:text-[#3A3836] cursor-pointer transition-colors ml-auto whitespace-nowrap">配置</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">
        {/* 与主页标题区域对齐的占位块（桌面端可见） */}
        <div className="hidden md:block mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[#2B2927] mb-2 sm:mb-3">
            Prompt 配置
          </h1>
          <p className="text-[#8A8681] text-xs sm:text-sm">修改后立即生效 · 重启后恢复默认</p>
        </div>
        {/* 移动端也显示标题（桌面端已占位，这里用移动端可见） */}
        <div className="md:hidden mb-4">
          <h1 className="text-xl font-bold text-[#2B2927]">Prompt 配置</h1>
          <p className="text-xs text-[#8A8681] mt-1">修改后立即生效 · 重启后恢复默认</p>
        </div>

        <div className="space-y-4">
          {Object.keys(PROMPT_LABELS).map(name => (
            <div key={name} className="bg-white border border-[#E8E6E1] rounded-2xl p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[#3A3836]">{PROMPT_LABELS[name]}</span>
                  <span className="text-[10px] text-[#A8A49D] font-mono">{name}</span>
                  {isDirty(name) && <span className="text-[10px] text-[#D97757]">未保存</span>}
                  {saved === name && <span className="text-[10px] text-[#478B4A]">已保存 ✓</span>}
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
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
                </div>
              </div>
              <textarea
                value={editing[name] ?? ''}
                onChange={e => setEditing(prev => ({ ...prev, [name]: e.target.value }))}
                className="w-full text-xs font-mono text-[#3A3836] bg-[#FAFAF8] border border-[#EEEAE4] rounded-lg p-3 outline-none focus:border-[#D97757] resize-none leading-relaxed"
                rows={Math.max(10, (editing[name] ?? '').split('\n').length + 2)}
              />
              <div className="text-[10px] text-[#C0BBB5] mt-1.5 text-right">
                {(editing[name] ?? '').length} 字符
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}