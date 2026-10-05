'use client'

import { useEffect, useRef, useState } from 'react'
import Card from '@/app/components/Card'
import DetailPanel from '@/app/components/DetailPanel'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import CcMarkdown from '@/app/cc/CcMarkdown'
import type { TrpgSettings, YanzhiRuntime } from '@/app/lib/trpg/server'
import { fieldClass, mergeLogs, phaseLabel, trpgRequest, type Log, type Table, type Sheet } from '@/app/lib/trpg/table'

const checkLabels: Record<string, string> = { san: '理智', luck: '幸运', characteristic: '属性', skill: '技能' }
const difficultyLabels: Record<string, string> = { regular: '普通', hard: '困难', extreme: '极难' }

function Character({ sheet }: { sheet: Sheet }) {
  return <div className="space-y-4">
    <h3 className="text-lg">{sheet.name} · {sheet.occupation}</h3>
    <dl className="grid grid-cols-2 gap-3">{(['hp', 'hp_max', 'san', 'san_start', 'mp', 'luck'] as const).map(key => <div key={key}><dt className="text-xs text-[var(--color-text-secondary)]">{{ hp: 'HP', hp_max: 'HP 上限', san: 'SAN', san_start: '初始 SAN', mp: 'MP', luck: '幸运' }[key]}</dt><dd>{sheet[key] ?? '—'}</dd></div>)}</dl>
    {(['characteristics', 'skills'] as const).map(key => <section key={key}><h4 className="mb-2 text-sm">{key === 'skills' ? '技能' : '属性'}</h4><dl className="grid grid-cols-2 gap-2">{Object.entries(sheet[key] || {}).map(([name, value]) => <div key={name} className="flex justify-between gap-2"><dt>{name}</dt><dd>{value}</dd></div>)}</dl></section>)}
    <section><h4 className="text-sm">背景</h4><p className="whitespace-pre-wrap break-words">{sheet.background || '—'}</p></section><section><h4 className="text-sm">备注</h4><p className="whitespace-pre-wrap break-words">{sheet.notes || '—'}</p></section>
  </div>
}

function RollLine({ text }: { text: string }) {
  let result: string
  try {
    const r = JSON.parse(text) as { value: number; target: number; grade: string; success: boolean; skill?: string; reason?: string; san_loss?: number; san_after?: number }
    const grades: Record<string, string> = { critical: '大成功', extreme: '极难成功', hard: '困难成功', regular: '普通成功', failure: '失败', fumble: '大失败' }
    result = `${r.skill || '检定'}：${r.value} / ${r.target} · ${grades[r.grade] || r.grade}（${r.success ? '通过' : '未通过'}）`
    if (r.san_loss !== undefined) result += ` · 理智损失 ${r.san_loss}，SAN ${r.san_after}`
    if (r.reason) result += ` · ${r.reason}`
  } catch { result = text }
  return <p className="whitespace-pre-wrap text-sm">🎲 {result}</p>
}

function LogEntry({ log, table }: { log: Log; table: Table }) {
  const person = log.author === 'xiaoyang' ? '小羊' : log.author === 'yanzhi' ? '言之' : '守秘人'
  const name = log.author === 'xiaoyang' ? table.my_character?.name : table.companions.find(c => c.owner === log.author)?.name
  if (log.kind === 'recap') return <Card><details><summary className="cursor-pointer py-2 text-sm">前情提要</summary><CcMarkdown text={log.text} /></details></Card>
  if (log.kind === 'roll') return <RollLine text={log.text} />
  if (log.kind === 'narration') return <CcMarkdown text={log.text} />
  return <div className={log.kind === 'table_talk' ? 'cc-bubble-assistant p-3 text-sm' : 'space-y-2'}>
    <p className="text-xs text-[var(--color-text-secondary)]">{person}{log.kind === 'action' ? `${name ? ` · ${name}` : ''}的行动` : log.kind === 'table_talk' ? ' · 桌边' : ' · 只有你看得到'}</p>
    <p className="whitespace-pre-wrap break-words">{log.text}</p>
  </div>
}

export default function TrpgTable({ gameId }: { gameId: string }) {
  const [table, setTable] = useState<Table | null>(null)
  const runningRuntime = useRef(false)
  const snapshot = useRef<Table | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'action' | 'table-talk'>('action')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<'character' | 'clues' | 'settings' | null>(null)
  const [settings, setSettings] = useState<TrpgSettings | null>(null)
  const [runtime, setRuntime] = useState<YanzhiRuntime | null>(null)
  const [dismissedError, setDismissedError] = useState('')
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let live = true
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    snapshot.current = null
    async function refresh() {
      if (running || !live) return
      running = true
      try {
        const seq = snapshot.current?.log.at(-1)?.seq || 0
        const response = await fetch(`/api/trpg/games/${encodeURIComponent(gameId)}/table?since_seq=${seq}`, { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '桌面读取失败')
        const [nextSettings, nextRuntime] = await Promise.all([trpgRequest<TrpgSettings>(`games/${gameId}/settings`), trpgRequest<YanzhiRuntime>(`games/${gameId}/yanzhi-runtime`)])
        if (live) {
          setSettings(nextSettings); setRuntime(nextRuntime); runningRuntime.current = !!nextRuntime.running_since
          if (!nextRuntime.last_error) setDismissedError('')
          const next = { ...data, log: mergeLogs(snapshot.current?.log || [], data.log) } as Table
          snapshot.current = next; setTable(next); setError('')
        }
      } catch (e) { if (live) setError((e as Error).message) } finally { if (live) setLoading(false); running = false }
    }
    function schedule() {
      clearTimeout(timer)
      if (!live || document.hidden) return
      timer = setTimeout(async () => { await refresh(); schedule() }, snapshot.current?.phase === 'players' && !runningRuntime.current ? 15000 : 3000)
    }
    async function visible() {
      clearTimeout(timer)
      if (!document.hidden) { await refresh(); schedule() }
    }
    refreshRef.current = async () => { await refresh(); schedule() }
    document.addEventListener('visibilitychange', visible)
    void visible()
    return () => { live = false; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [gameId])

  async function mutate(path: string, body: unknown) {
    setBusy(true); setError('')
    try {
      await trpgRequest(`games/${encodeURIComponent(gameId)}/${path}`, body)
      if (path === 'action' || path === 'table-talk') setText('')
      await refreshRef.current()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function changeModel(model: string) {
    setBusy(true)
    try {
      const response = await fetch(`/api/trpg/games/${encodeURIComponent(gameId)}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yanzhi_model: model }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '模型设置保存失败')
      setSettings(data)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const actionBlocked = mode === 'action' && table?.phase !== 'players'
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 pb-24 pt-5 text-[var(--color-text-primary)] sm:px-6">
    <SubpageBackButton href="/trpg" label="返回跑团列表" />
    {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}<button className="cc-btn-ghost ml-2 min-h-11" onClick={() => void refreshRef.current()}>重试</button></p>}
    {loading ? <p role="status">正在摆好桌子…</p> : !table ? <Card variant="empty">暂时无法读取这局，请重试。</Card> : <>
      <header className="space-y-2"><h1 className="text-3xl font-[family-name:var(--font-display)]">{table.title}</h1><p role="status" className="text-sm text-[var(--color-text-secondary)]">{runtime?.running_since ? '言之在想…' : phaseLabel[table.phase]}{table.scene && ` · ${table.scene.title}`}</p><div className="flex gap-2"><button className="cc-btn-ghost min-h-11" onClick={() => setPanel('character')}>角色卡</button><button className="cc-btn-ghost min-h-11" onClick={() => setPanel('clues')}>线索 · {table.clues.length}</button><button className="cc-btn-ghost min-h-11" onClick={() => setPanel('settings')}>设置</button></div></header>
      {runtime?.last_error && dismissedError !== `${runtime.last_error}:${runtime.last_seen_seq}` && <p role="alert" className="text-sm text-[var(--color-danger)]">{runtime.last_error}<button className="cc-btn-ghost ml-2 min-h-11" onClick={() => setDismissedError(`${runtime.last_error}:${runtime.last_seen_seq}`)}>关闭</button></p>}
      <section aria-label="叙事流" className="space-y-5">{table.log.map(log => <LogEntry key={log.seq} log={log} table={table} />)}</section>
      {table.phase === 'checks' && <section className="space-y-3" aria-label="待掷检定">{table.checks.filter(c => c.owner === 'xiaoyang' && c.status === 'pending').map(c => <Card key={c.id}><p>{c.skill || checkLabels[c.type] || '检定'} · {difficultyLabels[c.difficulty] || c.difficulty}</p><p className="text-sm">奖励骰 {c.bonus} · 惩罚骰 {c.penalty}{c.san_loss && ` · 理智损失 ${c.san_loss}`}</p><p className="my-2 text-sm text-[var(--color-text-secondary)]">{c.reason}</p><button className="cc-btn-primary min-h-11" disabled={busy} onClick={() => void mutate(`checks/${encodeURIComponent(c.id)}/roll`, {})}>掷骰</button></Card>)}{!table.checks.some(c => c.owner === 'xiaoyang') && <p className="text-sm text-[var(--color-text-secondary)]">等言之掷骰…</p>}</section>}
      <form className="cc-composer sticky bottom-[calc(var(--mobile-tabbar-height)+var(--mobile-tabbar-bottom)+12px)] space-y-3 p-3 md:bottom-4" onSubmit={e => { e.preventDefault(); if (!busy && !actionBlocked && text.trim()) void mutate(mode, { text: text.trim() }) }}>
        <div className="flex flex-wrap gap-2">{(['action', 'table-talk'] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'cc-btn-primary min-h-11' : 'cc-btn-ghost min-h-11'} onClick={() => setMode(m)}>{m === 'action' ? '行动' : '桌边话'}</button>)}{['players', 'yanzhi'].includes(table.phase) && <button type="button" className="cc-btn-ghost min-h-11" disabled={busy} onClick={() => void mutate('settle', { expected_phase: table.phase })}>直接结算</button>}</div>
        {actionBlocked && <p className="text-xs text-[var(--color-text-secondary)]">现在不能提交行动，等轮到你们；桌边话随时可以说。</p>}
        <label className="sr-only" htmlFor="trpg-input">{mode === 'action' ? '调查员行动' : '桌边话'}</label><textarea id="trpg-input" className={`${fieldClass} resize-none`} rows={3} value={text} disabled={busy || actionBlocked} onChange={e => setText(e.target.value)} placeholder={mode === 'action' ? '你的调查员准备做什么？' : '对言之说点桌边话…'} /><button className="cc-btn-primary min-h-11" disabled={busy || actionBlocked || !text.trim()}>发送</button>
      </form>
      <DetailPanel open={panel === 'settings'} onClose={() => setPanel(null)} mode="drawer"><div className="space-y-4 p-5"><h2 className="text-xl">跑团设置</h2><label className="block space-y-2"><span className="text-sm">言之用的模型</span><select className={fieldClass} value={settings?.yanzhi_model || 'claude-opus-4-6'} disabled={busy || !settings} onChange={e => void changeModel(e.target.value)}>{settings && !['claude-opus-4-6', 'claude-opus-5-5', 'claude-sonnet-5'].includes(settings.yanzhi_model) && <option value={settings.yanzhi_model}>{settings.yanzhi_model}</option>}<option value="claude-opus-4-6">Opus 4.6</option><option value="claude-opus-5-5">Opus 5.5</option><option value="claude-sonnet-5">Sonnet 5</option></select></label><p className="text-xs text-[var(--color-text-secondary)]">修改后下一回合生效。</p></div></DetailPanel>
      <DetailPanel open={panel === 'character'} onClose={() => setPanel(null)} mode="drawer"><div className="space-y-5 p-5 text-base"><h2 className="text-xl">角色卡</h2>{table.my_character ? <Character sheet={table.my_character} /> : <p>还没有角色卡</p>}<section><h3 className="mb-2 text-lg">同伴</h3>{table.companions.map(c => <p key={c.owner}>{c.name} · {c.occupation}</p>)}</section></div></DetailPanel>
      <DetailPanel open={panel === 'clues'} onClose={() => setPanel(null)} mode="drawer"><div className="space-y-4 p-5"><h2 className="text-xl">已公开线索</h2>{table.clues.length ? table.clues.map(c => <Card key={c.id}><h3 className="mb-2 text-lg">{c.title}{c.handout && <span className="ml-2 text-xs text-[var(--color-primary)]">Handout · 分发资料</span>}</h3><CcMarkdown text={c.text} /></Card>) : <p>还没有公开的线索</p>}</div></DetailPanel>
    </>}
  </main>
}
