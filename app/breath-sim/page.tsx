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
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-[#B0ACA6] whitespace-nowrap">{label}×{weight}</span>
      <div className="w-10 bg-[#EEEAE4] rounded-full h-1.5 flex-shrink-0">
        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(score * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-[9px] text-[#8A8681] tabular-nums">{score.toFixed(2)}</span>
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
    <div className="min-h-screen bg-[#F7F5F0]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">

        <div className="flex items-center gap-3 mb-6">
          <Link href="/" prefetch className="text-[#A8A49D] hover:text-[#D97757] text-sm transition-colors">← 返回</Link>
          <h1 className="text-lg font-semibold text-[#3A3836]">模拟 Breath</h1>
        </div>

        {/* 流程图 */}
        <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
          {[
            ['①', '输入', 'query / valence / arousal'],
            ['②', '候选池', `${data?.total_candidates ?? '—'} 桶`],
            ['③', '四维评分', 'topic · emotion · time · imp'],
            ['④', '阈值过滤', `${data?.threshold ?? 50} → ${data?.passed_count ?? '—'} 通过`],
            ['⑤', '排序', `top ${data?.results?.length ?? 'N'}`],
          ].map(([n, title, sub], i) => (
            <div key={i} className="flex items-center gap-1 flex-shrink-0">
              <div className="bg-white border border-[#E8E6E1] rounded-xl px-3 py-2 text-center min-w-[90px]">
                <div className="text-[10px] text-[#A8A49D]">{n} {title}</div>
                <div className="text-[10px] text-[#6C6965] mt-0.5">{sub}</div>
              </div>
              {i < 4 && <span className="text-[#D0CEC9] text-xs">→</span>}
            </div>
          ))}
        </div>

        {/* 输入区 */}
        <div className="bg-white border border-[#E8E6E1] rounded-2xl p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-36">
            <div className="text-[10px] text-[#A8A49D] mb-1">Query</div>
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && simulate()}
              placeholder="搜索关键词…"
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D97757]" />
          </div>
          <div className="w-24">
            <div className="text-[10px] text-[#A8A49D] mb-1">Valence 0~1</div>
            <input value={valence} onChange={e => setValence(e.target.value)} placeholder="—"
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D97757]" />
          </div>
          <div className="w-24">
            <div className="text-[10px] text-[#A8A49D] mb-1">Arousal 0~1</div>
            <input value={arousal} onChange={e => setArousal(e.target.value)} placeholder="—"
              className="w-full border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#D97757]" />
          </div>
          <button onClick={simulate} disabled={loading}
            className="bg-[#D97757] text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-[#C86645] disabled:opacity-50 transition-colors">
            {loading ? '模拟中…' : '模拟 Breath'}
          </button>
        </div>

        {/* 权重摘要 */}
        {data && (
          <div className="text-xs text-[#8A8681] mb-3 px-1">
            权重：topic×{data.weights?.topic} · emotion×{data.weights?.emotion} · time×{data.weights?.time} · imp×{data.weights?.importance}
            　｜　阈值 {data.threshold}　｜　候选 {data.total_candidates} → 通过 {data.passed_count}
          </div>
        )}

        {/* 结果列表 */}
        {data && (
          <div className="space-y-2">
            {data.results.map((b, i) => (
              <div key={b.id}
                className={`bg-white border rounded-xl px-4 py-3 ${b.passed_threshold ? 'border-[#E8E6E1]' : 'border-[#F0EFEB] opacity-55'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-[#A8A49D] w-5 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  {b.pinned && <span className="text-[#D97757] text-xs flex-shrink-0">★</span>}
                  <span className="text-sm font-medium text-[#3A3836] flex-1 truncate">{b.name}</span>
                  {b.vector_score > 0 && (
                    <span className="text-[10px] bg-[#EAF5E9] text-[#478B4A] px-1.5 py-0.5 rounded-full flex-shrink-0">
                      vec {b.vector_score.toFixed(2)}
                    </span>
                  )}
                  {!b.passed_threshold && <span className="text-[10px] text-[#A8A49D] flex-shrink-0">未过阈值</span>}
                  <span className={`text-sm font-bold ml-1 flex-shrink-0 ${b.passed_threshold ? 'text-[#D97757]' : 'text-[#A8A49D]'}`}>
                    {b.normalized.toFixed(1)}
                  </span>
                </div>
                {/* 四个维度并排，自动折行 */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(['topic', 'emotion', 'time', 'importance'] as const).map(k => (
                    <ScoreBar key={k} label={k} score={b.scores[k]} weight={b.weights[k]} color={BAR_COLORS[k]} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}