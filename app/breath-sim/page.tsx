'use client'
import { useState } from 'react'
import Link from 'next/link'

interface BucketScore {
  id: string; name: string; domain: string[]; type: string
  resolved: boolean; pinned: boolean; vector_score: number
  scores: { topic: number; emotion: number; time: number; importance: number }
  weights: { topic: number; emotion: number; time: number; importance: number }
  normalized: number; passed_threshold: boolean
}
interface DebugResult {
  query: string; weights: Record<string, number>; threshold: number
  total_candidates: number; passed_count: number; results: BucketScore[]
}

const BAR_COLORS = {
  topic: '#C86B45',
  emotion: '#D98D6A',
  time: '#DFA882',
  importance: '#C4B49A'
}

function ScoreBar({ label, score, weight, color }: { label: string; score: number; weight: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xs text-[#8A8681] whitespace-nowrap">{label}×{weight}</span>
      <div className="flex-1 bg-[#EEEAE4] rounded-full h-1.5 min-w-[2rem]">
        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(score * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-[#6C6965] tabular-nums w-10 text-right">{score.toFixed(2)}</span>
    </div>
  )
}

export default function BreathSimPage() {
  const [query, setQuery] = useState('')
  const [valence, setValence] = useState('')
  const [arousal, setArousal] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DebugResult | null>(null)

  const simulate = async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ q: query })
      if (valence) p.set('valence', valence)
      if (arousal) p.set('arousal', arousal)
      const res = await fetch(`/api/breath-debug?${p}`)
      const json = await res.json()
      if (json.error) { console.error('后端错误:', json.error); setData(null); return }
      setData(json)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-[#FCFAF8] text-[#3A3836] font-sans pb-20">

      {/* 顶部导航 */}
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
          <span className="cursor-pointer transition-colors h-full flex items-center whitespace-nowrap text-[#3A3836] border-b-2 border-[#D97757]">
            模拟 Breath
          </span>
          <span className="hover:text-[#3A3836] cursor-pointer transition-colors ml-auto whitespace-nowrap">配置</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">

        {/* 流程图 */}
        <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1 max-w-full">
          {[
            ['①', '输入', 'query / valence / arousal'],
            ['②', '候选池', `${data?.total_candidates ?? '—'} 桶`],
            ['③', '四维评分', 'topic · emotion · time · imp'],
            ['④', '阈值过滤', `${data?.threshold ?? 50} → ${data?.passed_count ?? '—'} 通过`],
            ['⑤', '排序', `top ${data?.results?.length ?? 'N'}`],
          ].map(([n, title, sub], i) => (
            <div key={i} className="flex items-center gap-1 flex-shrink-0">
              <div className="bg-white border border-[#E8E6E1] rounded-xl px-3 py-2 text-center min-w-[90px]">
                <div className="text-xs text-[#A8A49D]">{n} {title}</div>
                <div className="text-xs text-[#6C6965] mt-0.5">{sub}</div>
              </div>
              {i < 4 && <span className="text-[#D0CEC9] text-sm">→</span>}
            </div>
          ))}
        </div>

        {/* 输入区：移动端一行显示，左右间距对称 */}
        <div className="bg-white border border-[#E8E6E1] rounded-2xl p-3 sm:p-5 mb-6 flex flex-row flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[80px]">
            <div className="text-xs text-[#A8A49D] mb-1">Query</div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && simulate()}
              placeholder="搜索关键词…"
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D97757]"
            />
          </div>
          <div className="w-16 sm:w-20">
            <div className="text-xs text-[#A8A49D] mb-1">Valence</div>
            <input
              value={valence}
              onChange={e => setValence(e.target.value)}
              placeholder="0~1"
              className="w-full border border-[#E8E6E1] rounded-lg px-2 py-2 text-sm outline-none focus:border-[#D97757]"
            />
          </div>
          <div className="w-16 sm:w-20">
            <div className="text-xs text-[#A8A49D] mb-1">Arousal</div>
            <input
              value={arousal}
              onChange={e => setArousal(e.target.value)}
              placeholder="0~1"
              className="w-full border border-[#E8E6E1] rounded-lg px-2 py-2 text-sm outline-none focus:border-[#D97757]"
            />
          </div>
          <button
            onClick={simulate}
            disabled={loading}
            className="bg-[#D97757] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#C86645] disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {loading ? '模拟中…' : '模拟 Breath'}
          </button>
        </div>

        {/* 权重摘要：增加上下间距 */}
        {data && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#8A8681] my-5 px-1">
            <span>权重：<span className="text-[#6C6965]">topic×{data.weights?.topic}</span></span>
            <span className="hidden sm:inline text-[#D0CEC9]">·</span>
            <span className="text-[#6C6965]">emotion×{data.weights?.emotion}</span>
            <span className="hidden sm:inline text-[#D0CEC9]">·</span>
            <span className="text-[#6C6965]">time×{data.weights?.time}</span>
            <span className="hidden sm:inline text-[#D0CEC9]">·</span>
            <span className="text-[#6C6965]">imp×{data.weights?.importance}</span>
            <span className="mx-1 text-[#D0CEC9]">|</span>
            <span>阈值 <span className="text-[#3A3836]">{data.threshold}</span></span>
            <span className="mx-1 text-[#D0CEC9]">|</span>
            <span>候选 <span className="text-[#3A3836]">{data.total_candidates}</span> → 通过 <span className="text-[#D97757]">{data.passed_count}</span></span>
          </div>
        )}

        {/* 结果列表 */}
        {data && (
          <div className="space-y-3">
            {data.results.map((b, i) => (
              <div key={b.id}
                className={`bg-white border rounded-xl px-4 py-3 sm:px-5 sm:py-4 ${b.passed_threshold ? 'border-[#E8E6E1]' : 'border-[#F0EFEB] opacity-55'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-[#A8A49D] w-6 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  {b.pinned && <span className="text-[#D97757] text-sm flex-shrink-0">★</span>}
                  <span className="text-sm font-medium text-[#3A3836] flex-1 truncate">{b.name}</span>
                  {b.vector_score > 0 && (
                    <span className="text-xs bg-[#EAF5E9] text-[#478B4A] px-1.5 py-0.5 rounded-full flex-shrink-0">
                      vec {b.vector_score.toFixed(2)}
                    </span>
                  )}
                  {!b.passed_threshold && <span className="text-xs text-[#A8A49D] flex-shrink-0">未过阈值</span>}
                  <span className={`text-sm font-bold ml-1 flex-shrink-0 ${b.passed_threshold ? 'text-[#D97757]' : 'text-[#A8A49D]'}`}>
                    {b.normalized.toFixed(1)}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {(['topic', 'emotion', 'time', 'importance'] as const).map(k => (
                    <ScoreBar key={k} label={k} score={b.scores[k]} weight={b.weights[k]} color={BAR_COLORS[k]} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}