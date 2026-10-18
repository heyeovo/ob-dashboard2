'use client'
import { useEffect, useState } from 'react'
import DetailPanel from './DetailPanel'
import { WORD_BASELINE, formatWan, summarizeWordStats, type WordStatsDay, type WordSummary } from '../lib/wordStats'

let wordCache: WordStatsDay[] | null = null

/** 主页窗景里「说过 N 万字」那一行，点开看你我各说了多少、每个月多少 */
export default function HomeWordCount({ today }: { today: string }) {
  const [days, setDays] = useState<WordStatsDay[] | null>(() => wordCache)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void fetch('/api/cc-word-stats', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!data?.ok || !Array.isArray(data.days)) return
        wordCache = data.days
        setDays(data.days)
      })
      .catch(() => undefined)
  }, [])

  if (!days || !today) return <span className="home-quote-space" aria-hidden="true" />
  const summary = summarizeWordStats(days, today)

  return <>
    <button type="button" className="home-words" onClick={() => setOpen(true)}>
      说过 {formatWan(summary.total)}字
    </button>
    <DetailPanel open={open} onClose={() => setOpen(false)} mode="modal" width="max-w-md" className="!p-6">
      <WordDetail summary={summary} />
    </DetailPanel>
  </>
}

function WordDetail({ summary }: { summary: WordSummary }) {
  const peak = Math.max(1, ...summary.months.map(item => item.chars))
  const number = (value: number) => value.toLocaleString('zh-CN')
  return <div className="home-words-detail">
    <span className="home-kicker">WORDS · 我们说过的话</span>
    <div className="home-words-total"><b>{number(summary.total)}</b><span>字</span></div>
    <div className="home-words-split">
      <span>小羊 {formatWan(summary.user)}</span>
      <span>言之 {formatWan(summary.assistant)}</span>
      <span>今天 {number(summary.today)}</span>
    </div>
    <div className="home-words-rows">
      <div><span>闲聊</span><b>{number(summary.chat)}</b></div>
      <div><span>一起干活</span><b>{number(summary.work)}</b></div>
      <div><span>{WORD_BASELINE.note}</span><b>{number(WORD_BASELINE.chars)}</b></div>
    </div>
    {summary.months.length > 0 && <div className="home-words-months" aria-label="每个月">
      {summary.months.map(item => <div key={item.month} className="home-words-month">
        <span>{Number(item.month.slice(5, 7))}月</span>
        <i><em style={{ width: `${Math.max(2, (item.chars / peak) * 100)}%` }} /></i>
        <b>{formatWan(item.chars)}</b>
      </div>)}
    </div>}
    <p className="home-words-note">
      不算空格和换行，中文一个字、英文一个字母都算一个。{summary.firstDay ? `${Number(summary.firstDay.slice(5, 7))}月${Number(summary.firstDay.slice(8, 10))}日` : ''}以后的从聊天记录里数，回收站里的窗口不算；之前的是小羊在三个月纪念日那天数的。
    </p>
  </div>
}
