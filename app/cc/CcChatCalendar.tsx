'use client'
import { useEffect, useState } from 'react'
import DetailPanel from '@/app/components/DetailPanel'

type Day = { day: string; turn_count: number }
type Props = {
  open: boolean
  sessionId: string
  onClose: () => void
  onPick: (day: string) => Promise<boolean>
}

function dayKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export default function CcChatCalendar({ open, sessionId, onClose, onPick }: Props) {
  const [month, setMonth] = useState(() => new Date())
  const [days, setDays] = useState<Day[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  useEffect(() => {
    if (!open || !sessionId) return
    const controller = new AbortController()
    setMonth(new Date())
    setSelected('')
    setLoading(true)
    setError('')
    void fetch(`/api/cc-turns?session_id=${encodeURIComponent(sessionId)}&days=1`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      const data = await response.json() as { ok?: boolean; days?: Day[]; error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || '日期读取失败')
      setDays(Array.isArray(data.days) ? data.days : [])
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, sessionId])
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const count = new Date(year, monthIndex + 1, 0).getDate()
  const available = new Set(days.filter(day => day.turn_count > 0).map(day => day.day))
  const now = new Date()
  const today = dayKey(now.getFullYear(), now.getMonth(), now.getDate())
  return (
    <DetailPanel open={open} onClose={onClose} mode="modal" width="max-w-sm">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <button type="button" aria-label="上个月" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} className="flex size-11 items-center justify-center rounded-full text-lg">‹</button>
          <h2 className="text-md font-semibold text-[var(--color-text-heading)]">{year} 年 {monthIndex + 1} 月</h2>
          <button type="button" aria-label="下个月" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} className="flex size-11 items-center justify-center rounded-full text-lg">›</button>
        </div>
        <div className="mt-2 grid grid-cols-7 text-center text-2xs text-[var(--color-text-tertiary)]">
          {['一','二','三','四','五','六','日'].map(label => <span key={label} className="py-2">{label}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: firstOffset }, (_, index) => <span key={`blank-${index}`} />)}
          {Array.from({ length: count }, (_, index) => {
            const date = dayKey(year, monthIndex, index + 1)
            const active = available.has(date)
            return <button key={date} type="button" disabled={!active || loading}
              title={active ? `${days.find(item => item.day === date)?.turn_count || 0} 轮` : '这天没有消息'}
              onClick={() => { setSelected(date); void onPick(date).then(found => { if (found) onClose(); else setError('这一天没有聊天记录') }) }}
              className={`mx-auto flex size-10 flex-col items-center justify-center rounded-full text-sm ${active ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'text-[var(--color-text-disabled)]'} ${date === selected ? '!bg-[var(--color-primary)] !text-[var(--color-on-primary)]' : ''} ${date === today ? 'ring-1 ring-[var(--color-primary)]' : ''}`}>
              {index + 1}{active ? <span className="mt-0.5 size-1 rounded-full bg-current" /> : null}
            </button>
          })}
        </div>
        {loading ? <p className="mt-3 text-center text-meta text-[var(--color-text-tertiary)]">正在读取日期…</p> : null}
        {error ? <p className="mt-3 text-center text-meta text-[var(--color-danger)]">{error}</p> : null}
      </div>
    </DetailPanel>
  )
}
