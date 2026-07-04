'use client'
import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import BucketDetailDrawer from '../components/BucketDetailDrawer'
import StatusBadge, { statusLabel as getStatus } from '../components/StatusBadge'
import Card from '../components/Card'
import KnobRow from '../components/KnobRow'
import KnobToggle from '../components/KnobToggle'
import ScoreBar from '../components/ScoreBar'

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
interface BucketDetail {
  id: string; content: string; score: number; noise?: boolean
  metadata: { name: string; domain: string[]; tags: string[]; valence: number; arousal: number; importance: number; pinned: boolean; resolved: boolean; digested?: boolean; type: string; created: string; last_active: string; activation_count?: number; event_time?: string }
}

const BAR_COLORS = { topic: '#C86B45', emotion: '#D98D6A', time: '#DFA882', importance: '#C4B49A' }
const SLIDER_STYLE = `w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[var(--color-primary)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-[var(--color-primary)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0`
const SCORING_LS_KEY = 'breath-sim-scoring'

function loadScoringFromLS(): Record<string, any> {
  if (typeof window === 'undefined') return {}
  try { const s = localStorage.getItem(SCORING_LS_KEY); return s ? JSON.parse(s) : {} } catch { return {} }
}
function saveScoringToLS(v: Record<string, any>) {
  try { localStorage.setItem(SCORING_LS_KEY, JSON.stringify(v)) } catch {}
}
function clearScoringLS() {
  try { localStorage.removeItem(SCORING_LS_KEY) } catch {}
}

export default function BreathSimPage() {
  const [query, setQuery] = useState(''); const [valence, setValence] = useState(''); const [arousal, setArousal] = useState('')
  const [loading, setLoading] = useState(false); const [data, setData] = useState<DebugResult | null>(null)
  const [selected, setSelected] = useState<BucketDetail | null>(null); const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false); const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false); const [operating, setOperating] = useState(false); const [copied, setCopied] = useState(false)
  const [threshold, setThreshold] = useState(55)
  const [activeTab, setActiveTab] = useState<'pipeline' | 'hitstats' | 'trace' | 'sim'>('pipeline')

  const [hitStats, setHitStats] = useState<{ total_searches: number; tracked_buckets: number; items: any[] } | null>(null)
  const [hitStatsLoading, setHitStatsLoading] = useState(false); const [hitStatsOrder, setHitStatsOrder] = useState<'desc' | 'asc'>('desc')
  const [recentSearches, setRecentSearches] = useState<any[]>([]); const [recentLoading, setRecentLoading] = useState(false)
  const [simQuery, setSimQuery] = useState(''); const [simLoading, setSimLoading] = useState(false); const [simResults, setSimResults] = useState<any[]>([]); const [vecResults, setVecResults] = useState<any[]>([])
  const [scoringCurrent, setScoringCurrent] = useState<Record<string, any>>(loadScoringFromLS)
  const [bucketMeta, setBucketMeta] = useState<Map<string, any>>(new Map())

  useEffect(() => { fetch('/api/buckets').then(r => r.json()).then(data => { const m = new Map(); (data || []).forEach((b: any) => m.set(b.id, b)); setBucketMeta(m) }).catch(() => {}) }, [])

  const openBucket = async (id: string) => { setDetailLoading(true); setSelected(null); try { setSelected(await (await fetch(`/api/bucket/${id}`)).json()) } finally { setDetailLoading(false) } }
  const traceOp = async (id: string, args: Record<string, unknown>) => {
    if (selected && selected.id === id && 'resolved' in args) { setSelected((prev: any) => prev ? { ...prev, metadata: { ...prev.metadata, resolved: Boolean(args.resolved), importance: args.importance != null ? Number(args.importance) : prev.metadata.importance }, noise: Boolean(args.resolved) && (args.importance != null ? Number(args.importance) : prev.metadata.importance) === 1 } : prev) }
    setOperating(true); try { await fetch('/api/edit-bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...args }) }); setSelected(await (await fetch(`/api/bucket/${id}`)).json()) } finally { setOperating(false) }
  }
  const saveEdit = async () => { if (!selected) return; setSaving(true); await fetch('/api/edit-bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, content: editContent }) }); setSaving(false); setEditing(false); openBucket(selected.id) }
  const copyId = () => { if (!selected) return; navigator.clipboard.writeText(selected.id); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const simulate = async () => { setLoading(true); try { const p = new URLSearchParams({ q: query }); if (valence) p.set('valence', valence); if (arousal) p.set('arousal', arousal); p.set('threshold', threshold.toString()); const j = await (await fetch(`/api/breath-debug?${p}`)).json(); if (j.error) { console.error(j.error); setData(null); return } setData(j) } catch (e) { console.error(e) } finally { setLoading(false) } }

  const fetchHitStats = async (order?: string) => { setHitStatsLoading(true); try { const d = await (await fetch(`/api/hit-stats?limit=50&include_zero=true&order=${order || hitStatsOrder}`)).json(); if (!d.error) setHitStats(d) } catch (e) { console.error(e) } finally { setHitStatsLoading(false) } }
  const fetchRecentSearches = async () => { setRecentLoading(true); try { const d = await (await fetch('/api/recent-searches?limit=20')).json(); if (!d.error) setRecentSearches(d) } catch (e) { console.error(e) } finally { setRecentLoading(false) } }
  const doInstantSim = async () => { if (!simQuery.trim()) return; setSimLoading(true); setSimResults([]); setVecResults([]); try { const d = await (await fetch(`/api/search?q=${encodeURIComponent(simQuery)}&simulate=true&limit=20&include_vector=true`)).json(); if (!d.error) { if (Array.isArray(d)) { setSimResults(d); setVecResults([]) } else { setSimResults(d.items || []); setVecResults(d.vector_only || []) } } } catch (e) { console.error(e) } finally { setSimLoading(false) } }
  const fetchScoringConfig = async () => { try { const d = await (await fetch('/api/scoring-config')).json(); if (!d.error && d.current) { setScoringCurrent(d.current); saveScoringToLS(d.current) } } catch (e) { console.error(e) } }
  const updateScoringKnob = async (key: string, value: any) => { setScoringCurrent(prev => { const next = { ...prev, [key]: value }; saveScoringToLS(next); return next }); try { await fetch('/api/scoring-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) }) } catch (e) { console.error(e) } }
  const resetScoringConfig = async () => { try { await fetch('/api/scoring-config/reset', { method: 'POST' }); clearScoringLS(); await fetchScoringConfig() } catch (e) { console.error(e) } }

  useEffect(() => { fetch('/api/config').then(r => r.json()).then(d => { if (d.fuzzy_threshold) setThreshold(d.fuzzy_threshold) }).catch(() => {}); fetchScoringConfig() }, [])

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans pb-20">
      <NavBar activeSlug="breath-sim" />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10">

        <div className="flex gap-1 mb-6 bg-[var(--color-surface-tertiary)] rounded-xl p-1 w-fit">
          {([{ key: 'pipeline', label: '模拟 Pipeline' }, { key: 'sim', label: '即时模拟' }, { key: 'hitstats', label: '命中统计' }, { key: 'trace', label: '检索追溯' }] as const).map(t => (
            <button key={t.key} onClick={() => { setActiveTab(t.key); if (t.key === 'hitstats' && !hitStats) fetchHitStats(); if (t.key === 'trace' && recentSearches.length === 0) fetchRecentSearches(); if (t.key === 'sim' && Object.keys(scoringCurrent).length === 0) fetchScoringConfig() }}
              className={`text-xs sm:text-sm px-3 sm:px-4 py-1.5 rounded-lg font-medium transition-colors ${activeTab === t.key ? 'bg-white text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'}`}>{t.label}</button>
          ))}
        </div>

        {/* Pipeline Tab */}
        {activeTab === 'pipeline' && <>
          <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1 max-w-full">
            {[['1', '输入', 'query / valence / arousal'], ['2', '候选池', `${data?.total_candidates ?? '--'} 桶`], ['3', '四维评分', 'topic . emotion . time . imp'], ['4', '阈值过滤', `${data?.threshold ?? threshold} \\u2192 ${data?.passed_count ?? '--'} 通过`], ['5', '排序', `top ${data?.results?.length ?? 'N'}`]].map(([n, title, sub], i) => (
              <div key={i} className="flex items-center gap-1 flex-shrink-0"><div className="bg-white border border-[var(--color-border)] rounded-xl px-3 py-2 text-center min-w-[90px]"><div className="text-xs text-[var(--color-text-disabled)]">{n} {title}</div><div className="text-xs text-[var(--color-text-secondary)] mt-0.5">{sub}</div></div>{i < 4 && <span className="text-[var(--color-text-divider)] text-sm">{'->'}</span>}</div>
            ))}
          </div>
          <div className="bg-white border border-[var(--color-border)] rounded-2xl p-3 sm:p-5 mb-6 flex flex-row flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[80px]"><div className="text-xs text-[var(--color-text-disabled)] mb-1">Query</div><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && simulate()} placeholder="搜索关键词..." className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" /></div>
            <div className="w-16 sm:w-20"><div className="text-xs text-[var(--color-text-disabled)] mb-1">Valence</div><input value={valence} onChange={e => setValence(e.target.value)} placeholder="0~1" className="w-full border border-[var(--color-border)] rounded-lg px-2 py-2 text-sm outline-none focus:border-[var(--color-primary)]" /></div>
            <div className="w-16 sm:w-20"><div className="text-xs text-[var(--color-text-disabled)] mb-1">Arousal</div><input value={arousal} onChange={e => setArousal(e.target.value)} placeholder="0~1" className="w-full border border-[var(--color-border)] rounded-lg px-2 py-2 text-sm outline-none focus:border-[var(--color-primary)]" /></div>
            <button onClick={simulate} disabled={loading} className="w-28 bg-[var(--color-primary)] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors flex-shrink-0">{loading ? '模拟中...' : '模拟 Breath'}</button>
            <div className="w-full flex items-center gap-4 pt-1">
              <div className="flex-1 flex items-center gap-3"><span className="text-xs text-[var(--color-text-disabled)] whitespace-nowrap">阈值</span><input type="range" min="0" max="100" value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${threshold}%, var(--color-border-subtle) ${threshold}%)` }} className={SLIDER_STYLE} /><span className="text-sm font-medium text-[var(--color-primary)] w-4 text-right tabular-nums">{threshold}</span></div>
              <button onClick={async () => { const d = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fuzzy_threshold: threshold }) })).json(); if (d.ok) alert(`已应用：阈值 ${d.fuzzy_threshold}`) }} className="w-28 bg-[var(--color-primary)] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors flex-shrink-0">应用到后端</button>
            </div>
          </div>
          {data && (<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--color-text-tertiary)] my-5 px-1"><span>权重：<span className="text-[var(--color-text-secondary)]">topic x{data.weights?.topic}</span></span><span className="hidden sm:inline text-[var(--color-text-divider)]">.</span><span className="text-[var(--color-text-secondary)]">emotion x{data.weights?.emotion}</span><span className="hidden sm:inline text-[var(--color-text-divider)]">.</span><span className="text-[var(--color-text-secondary)]">time x{data.weights?.time}</span><span className="hidden sm:inline text-[var(--color-text-divider)]">.</span><span className="text-[var(--color-text-secondary)]">imp x{data.weights?.importance}</span><span className="mx-1 text-[var(--color-text-divider)]">|</span><span>阈值 <span className="text-[var(--color-text-primary)]">{data.threshold}</span></span><span className="mx-1 text-[var(--color-text-divider)]">|</span><span>候选 <span className="text-[var(--color-text-primary)]">{data.total_candidates}</span> {`->`} 通过 <span className="text-[var(--color-primary)]">{data.passed_count}</span></span></div>)}
          {data && (<div className="space-y-3">{data.results.map((b, i) => (
            <Card key={b.id} padding="lg" variant="interactive" onClick={() => openBucket(b.id)} className={!b.passed_threshold ? 'opacity-55 border-[var(--color-border-light)]' : ''}>
              <div className="flex items-center gap-2 mb-2"><span className="text-xs text-[var(--color-text-disabled)] w-6 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>{b.pinned && <span className="text-[var(--color-primary)] text-sm flex-shrink-0">*</span>}<span className="text-sm font-medium text-[var(--color-text-primary)] flex-1 truncate">{b.name}</span>{b.vector_score > 0 && <span className="text-xs bg-[var(--color-digested-bg)] text-[var(--color-digested)] px-1.5 py-0.5 rounded-full flex-shrink-0">vec {b.vector_score.toFixed(2)}</span>}{!b.passed_threshold && <span className="text-xs text-[var(--color-text-disabled)] flex-shrink-0">未过阈值</span>}<span className={`text-sm font-bold ml-1 flex-shrink-0 ${b.passed_threshold ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-disabled)]'}`}>{b.normalized.toFixed(1)}</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">{(['topic', 'emotion', 'time', 'importance'] as const).map(k => <ScoreBar key={k} label={k} score={b.scores[k]} weight={b.weights[k]} color={BAR_COLORS[k]} />)}</div>
            </Card>
          ))}</div>)}
        </>}

        {/* Instant Simulation + Knobs (side panel) */}
        {activeTab === 'sim' && (
          <div className="flex gap-5 items-start">
            <div className="w-52 flex-shrink-0 bg-white border border-[var(--color-border)] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-[var(--color-text-primary)]">评分旋钮</span><button onClick={resetScoringConfig} className="text-[10px] text-red-500 hover:text-red-700">重置</button></div>
              <KnobRow label="content_weight" desc="正文权重" value={scoringCurrent.content_weight ?? 1.0} min={0} max={5} step={0.5} onChange={v => updateScoringKnob('content_weight', v)} />
              <KnobRow label="title_hit_bonus" desc="标题加分" value={scoringCurrent.title_hit_bonus ?? 0.0} min={0} max={100} step={1} onChange={v => updateScoringKnob('title_hit_bonus', v)} />
              <KnobToggle label="token_exact" desc="token精确匹配(默认开)" checked={scoringCurrent.token_exact_match ?? true} onChange={v => updateScoringKnob('token_exact_match', v)} />
              <KnobToggle label="keyword_first" desc="标题命中排最前" checked={scoringCurrent.keyword_first_sort ?? false} onChange={v => updateScoringKnob('keyword_first_sort', v)} />
              <KnobToggle label="keyword_bypass" desc="命中name/domain/tags跳过阈值" checked={scoringCurrent.keyword_bypass ?? false} onChange={v => updateScoringKnob('keyword_bypass', v)} />
              <KnobToggle label="precise_match" desc="token精确+砍评分+绕过阈值" checked={scoringCurrent.precise_match_mode ?? false} onChange={v => updateScoringKnob('precise_match_mode', v)} />
              <KnobRow label="warmth_boost" desc="积极记忆偏置" value={scoringCurrent.warmth_boost ?? 0.0} min={0} max={5} step={0.5} onChange={v => updateScoringKnob('warmth_boost', v)} />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="bg-white border border-[var(--color-border)] rounded-2xl p-3 flex gap-2 items-end">
                <div className="flex-1"><input value={simQuery} onChange={e => setSimQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doInstantSim()} placeholder="输入查询词（不计入统计）..." className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]" /></div>
                <button onClick={doInstantSim} disabled={simLoading || !simQuery.trim()} className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors flex-shrink-0">{simLoading ? '检索中...' : '即时模拟'}</button>
              </div>
              {(simResults.length === 0 && vecResults.length === 0) && !simLoading && <Card variant="empty" padding="md" className="py-16 text-center text-sm text-[var(--color-text-disabled)]">输入关键词后点击即时模拟查看命中详情</Card>}
              {(simResults.length > 0 || vecResults.length > 0) && (() => {
                const FC: Record<string, string> = { name: 'var(--color-primary)', domain: 'var(--color-text-tertiary)', tags: 'var(--color-resolved)', content: 'var(--color-digested)' }
                const kw = simResults.filter((b: any) => b.matched_fields?.matched_in?.length > 0)
                // Reuse shared statusLabel function from StatusBadge component
                const badgeFor = (meta: any) => { const st = getStatus(meta); return st ? <StatusBadge type={st} size="xs" /> : null }
                return (<div className="space-y-5">
                  {/* Keyword hits */}
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-[var(--color-text-secondary)] px-1">Keyword Matches ({kw.length})</div>
                    {kw.length === 0 ? <Card variant="empty" padding="sm" className="py-4 text-center text-xs text-[var(--color-text-disabled)]">No keyword matches</Card> : kw.map((b: any) => { const meta = bucketMeta.get(b.id); return (<Card key={b.id} variant="interactive" padding="sm" onClick={() => openBucket(b.id)} className="flex items-center gap-2 hover:border-[var(--color-primary)]/40"><span className="text-xs font-medium text-[var(--color-text-primary)] truncate flex-1">{b.name || b.id}</span>{badgeFor(meta)}<span className="text-xs font-bold text-[var(--color-primary)] flex-shrink-0">{b.score}</span><div className="flex gap-1 flex-shrink-0">{b.matched_fields?.matched_in?.map((f: string) => { const v = b.matched_fields[f]; return <span key={f} className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium" style={{ borderColor: FC[f] || 'var(--color-text-disabled)', color: FC[f], background: `${FC[f]}15` }}>{f} {v.toFixed(0)}%</span> })}</div></Card>)})}
                  </div>
                  {/* Semantic recall */}
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-[var(--color-text-secondary)] px-1">Semantic Recall ({vecResults.length})</div>
                    {vecResults.length === 0 ? <Card variant="empty" padding="sm" className="py-4 text-center text-xs text-[var(--color-text-disabled)]">No vector matches</Card> : vecResults.map((b: any) => (<Card key={b.id} variant="interactive" padding="sm" onClick={() => openBucket(b.id)} className="hover:border-[var(--color-digested)]/40"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-[var(--color-text-primary)] truncate flex-1">{b.name || b.id}</span><span className="text-xs font-bold text-[var(--color-digested)] flex-shrink-0">{b.vector_similarity?.toFixed(2) || '--'}</span></div></Card>))}
                  </div>
                </div>)
              })()}
            </div>
          </div>
        )}

        {/* Hit Stats Tab */}
        {activeTab === 'hitstats' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><div className="text-sm text-[var(--color-text-tertiary)]">共追踪 <span className="text-[var(--color-text-primary)] font-medium">{hitStats?.tracked_buckets ?? '--'}</span> 个桶 . 累计搜索 <span className="text-[var(--color-text-primary)] font-medium">{hitStats?.total_searches ?? '--'}</span> 次</div><div className="flex gap-2"><button onClick={() => { const o = hitStatsOrder === 'desc' ? 'asc' : 'desc'; setHitStatsOrder(o); fetchHitStats(o) }} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors">{hitStatsOrder === 'desc' ? '热门优先' : '冷门优先'}</button><button onClick={() => fetchHitStats()} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors">{hitStatsLoading ? '刷新中...' : '刷新'}</button><button onClick={async () => { await fetch('/api/hit-stats', { method: 'POST' }); setHitStats(null) }} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-red-500 hover:bg-red-50 transition-colors">重置统计</button></div></div>
            {!hitStats ? <Card variant="empty" padding="md" className="py-20 text-center text-sm text-[var(--color-text-disabled)]">{hitStatsLoading ? '读取中...' : '点击刷新加载命中统计'}</Card> : hitStats.items.length === 0 ? <Card variant="empty" padding="md" className="py-20 text-center text-sm text-[var(--color-text-disabled)]">还没有命中数据，先进行一次搜索</Card> : (
              <div className="space-y-2">{hitStats.items.map((item: any) => (<Card key={item.id} variant="interactive" padding="sm" onClick={() => openBucket(item.id)} className="flex items-center gap-4"><span className={`text-xs font-mono w-10 text-right flex-shrink-0 ${item.count === 0 ? 'text-[var(--color-text-disabled)]' : 'text-[var(--color-primary)] font-bold'}`}>{item.count === 0 ? '--' : item.count}次</span><div className="flex-1 min-w-0"><div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{item.name || item.id}</div>{item.last_query && <div className="text-xs text-[var(--color-text-disabled)] truncate">最近: {item.last_query}</div>}</div>{item.surface_count > 0 && <span className="text-xs text-[var(--color-text-disabled)] flex-shrink-0">浮现{item.surface_count}次</span>}</Card>))}</div>
            )}
          </div>
        )}

        {/* Search Trace Tab */}
        {activeTab === 'trace' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><div className="text-sm text-[var(--color-text-tertiary)]">最近 <span className="text-[var(--color-text-primary)] font-medium">{recentSearches.length}</span> 条检索/浮现记录</div><button onClick={fetchRecentSearches} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors">{recentLoading ? '刷新中...' : '刷新'}</button></div>
            {recentSearches.length === 0 ? <Card variant="empty" padding="md" className="py-20 text-center text-sm text-[var(--color-text-disabled)]">{recentLoading ? '读取中...' : '还没有检索记录'}</Card> : (
              <div className="space-y-2">{recentSearches.map((entry: any, i: number) => (<Card key={i} variant="outline" padding="sm"><div className="flex items-center gap-2 mb-2"><span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${entry.kind === 'surface' ? 'bg-[var(--color-resolved-bg)] text-[var(--color-resolved)]' : 'bg-[var(--color-pinned-bg)] text-[var(--color-primary)]'}`}>{entry.kind === 'surface' ? '浮现' : '检索'}</span><span className="text-sm font-medium text-[var(--color-text-primary)]">{entry.kind === 'surface' ? '无查询浮现' : entry.query}</span><span className="text-xs text-[var(--color-text-disabled)] ml-auto">{entry.time_iso?.slice(0, 16)?.replace('T', ' ')} · {entry.count}条</span></div>{entry.top?.length > 0 && <div className="flex flex-wrap gap-1.5">{entry.top.slice(0, 5).map((item: any) => <span key={item.id} onClick={(e) => { e.stopPropagation(); openBucket(item.id) }} className="text-xs bg-[var(--color-surface-secondary)] px-2 py-1 rounded-md cursor-pointer hover:bg-[var(--color-border-light)] transition-colors">{item.name || item.id}{item.score != null && <span className="text-[var(--color-text-disabled)] ml-1">{item.score.toFixed(0)}</span>}</span>)}</div>}</Card>))}</div>
            )}
          </div>
        )}
      </main>
      <BucketDetailDrawer selected={selected} detailLoading={detailLoading} editing={editing} editContent={editContent} saving={saving} operating={operating} copied={copied}
        onClose={() => { setSelected(null); setEditing(false) }} onStartEdit={(content) => { setEditing(true); setEditContent(content) }} onCancelEdit={() => setEditing(false)} onSaveEdit={saveEdit}
        onTraceOp={traceOp} onCopyId={copyId} onTouch={async (id) => { await fetch(`/api/touch/${id}`, { method: 'POST' }) }} onArchive={async (id) => { await fetch(`/api/archive/${id}`, { method: 'POST' }) }} onActivate={async (id) => { await fetch(`/api/touch/${id}?ripple=true`, { method: 'POST' }) }} />
    </div>
  )
}

