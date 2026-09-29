'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import HomeToolDrawer from './components/HomeToolDrawer'
import HomeSillArt from './components/HomeSillArt'
import { daysTogether, upcomingAnniversaries } from './lib/anniversaries'
import { bucketDate, bucketName, isLegacyDailyImpression, type DatedBucket } from './lib/dailyBucketDate'

type Persona = { id: string; name?: string; initial?: string }
type Review = { review_date: string }
type Journal = { name: string; author: string; created: string; event_time?: string; locked?: boolean }
type Reminder = { title: string; status: string; next_due_at?: string | null; start_at?: string | null }
type Todo = { done: boolean }

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' })
const lintelFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', weekday: 'short', month: 'short', day: 'numeric' })
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
function dateAt(offset: number, date: string) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10) }
function shortDate(date: string) { return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}` }

// 客户端内切页回来时先用上次的内容，再在后台刷新；整页刷新会丢，属于允许丢失的运行态
type HomeCache = { today: string; persona: Persona; journal: Journal | null; reviews: Review[]; buckets: DatedBucket[]; reminders: Reminder[]; todos: Todo[] }
let homeCache: HomeCache | null = null

export default function HomePage() {
  const [toolsOpen, setToolsOpen] = useState(false)
  const [today, setToday] = useState(() => homeCache?.today || '')
  const [selectedDate, setSelectedDate] = useState('')
  const [persona, setPersona] = useState<Persona>(() => homeCache?.persona || { id: 'ombre', name: '言之', initial: '言' })
  const [journal, setJournal] = useState<Journal | null>(() => homeCache?.journal ?? null)
  const [reviews, setReviews] = useState<Review[]>(() => homeCache?.reviews || [])
  const [buckets, setBuckets] = useState<DatedBucket[]>(() => homeCache?.buckets || [])
  const [reminders, setReminders] = useState<Reminder[]>(() => homeCache?.reminders || [])
  const [todos, setTodos] = useState<Todo[]>(() => homeCache?.todos || [])

  useEffect(() => {
    const update = () => setToday(dateFormatter.format(new Date()))
    update()
    const timer = window.setInterval(update, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    void fetch('/api/cc-personas', { cache: 'no-store' }).then(response => response.json()).then(data => {
      const items: Persona[] = Array.isArray(data.personas) ? data.personas : Array.isArray(data.items) ? data.items : []
      const chosen = items.find(item => item.id === 'ombre') || items[0]
      if (chosen) setPersona(chosen)
    }).catch(() => undefined)
  }, [])
  const week = useMemo(() => {
    if (!today) return []
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
    return weekdays.map((label, index) => ({ label, date: dateAt(index - weekday, today) }))
  }, [today])
  useEffect(() => {
    if (!today || week.length === 0) return
    const urls = [
      '/api/journal',
      `/api/daily-reviews?persona_id=${encodeURIComponent(persona.id)}&start_date=${week[0].date}&end_date=${week[6].date}`,
      '/api/buckets?limit=200',
      '/api/care/reminders?status=active&limit=200',
      '/api/care/todos?done=false&limit=500',
    ]
    void Promise.allSettled(urls.map(async url => {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('Home data unavailable')
      return response.json()
    })).then(([journalResult, reviewResult, bucketResult, reminderResult, todoResult]) => {
      if (journalResult.status === 'fulfilled') {
        const items: Journal[] = Array.isArray(journalResult.value) ? journalResult.value : []
        setJournal([...items].sort((a, b) => (b.event_time || b.created).localeCompare(a.event_time || a.created))[0] || null)
      }
      if (reviewResult.status === 'fulfilled') setReviews(Array.isArray(reviewResult.value.items) ? reviewResult.value.items : [])
      if (bucketResult.status === 'fulfilled') {
        const data = bucketResult.value
        setBuckets((Array.isArray(data) ? data : Array.isArray(data.buckets) ? data.buckets : []).filter((item: DatedBucket) => !isLegacyDailyImpression(item)))
      }
      if (reminderResult.status === 'fulfilled') setReminders(Array.isArray(reminderResult.value.reminders) ? reminderResult.value.reminders : [])
      if (todoResult.status === 'fulfilled') setTodos(Array.isArray(todoResult.value.todos) ? todoResult.value.todos : [])
    })
  }, [today, week, persona.id])

  useEffect(() => {
    if (today) homeCache = { today, persona, journal, reviews, buckets, reminders, todos }
  }, [today, persona, journal, reviews, buckets, reminders, todos])

  const anniversaries = today ? upcomingAnniversaries(today) : []
  const next = anniversaries[0]
  const activeDate = selectedDate || today
  const activeBuckets = buckets.filter(bucket => bucketDate(bucket) === activeDate)
  const activeReview = reviews.some(review => review.review_date === activeDate)
  const upcomingReminder = reminders.filter(item => item.status === 'active' && (item.next_due_at || item.start_at || '').slice(0, 10) >= today)
    .sort((a, b) => (a.next_due_at || a.start_at || '').localeCompare(b.next_due_at || b.start_at || ''))[0]
  const pendingCount = todos.filter(item => !item.done).length
  const avatar = persona.initial || persona.name?.slice(0, 1) || '言'

  return <div className="home-page mobile-page-with-topbar min-h-screen text-[var(--color-text-primary)]">
    <header className="home-lintel mobile-page-topbar">
      <button type="button" aria-label="打开家的其他房间" onClick={() => setToolsOpen(true)} className="home-burger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h11M4 17h16" /></svg></button>
      <span className="home-lintel-date">{today ? lintelFormatter.format(new Date(`${today}T12:00:00+08:00`)).replace(',', ' ·').toUpperCase() : ''}</span>
      <Link href="/persona?tab=state" className="home-avatar" aria-label={`${persona.name || '协作者'}的状态`}>{avatar}</Link>
    </header>
    <main className="home-main">
      <section className="home-pane" aria-label="我们的家">
        <div className="home-window-view"><div className="home-window-rain" aria-hidden="true" /><div className="home-window-sky">
          <span className="home-since">SINCE 04 · 03</span>
          <h1>小言<span className="home-amp">&amp;</span>小羊的家</h1>
          <span className="home-day">Day {today ? daysTogether(today) : '—'}</span>
          <span className="home-ornament" aria-hidden="true"><i /><b /><i /></span>
          <span className="home-quote-space" aria-hidden="true" />
        </div></div>
        <HomeSillArt kind="cat" />
        {next && <div className="home-anniversary" aria-label="下一个纪念日">
          <HomeSillArt kind="clawd" /><span className="home-kicker">NEXT · 纪念日</span>
          <div className="home-anniversary-name">{next.name}</div>
          <div className="home-anniversary-count"><b>{next.daysAway === 0 ? '今天' : next.daysAway}</b>{next.daysAway > 0 && <span>天后 · {Number(next.date.slice(5, 7))}月{Number(next.date.slice(8, 10))}日</span>}</div>
          <div className="home-anniversary-rest">{anniversaries.slice(1, 4).map(item => <span key={item.date}>{item.name} · {shortDate(item.date)}</span>)}</div>
        </div>}
      </section>
      <div className="home-desk">
        <Link href="/journal" className="home-desk-block home-diary"><span className="home-diary-spine" aria-hidden="true" /><span><span className="home-kicker">DIARY · 日记本</span><strong>{journal ? journal.locked ? '上锁的一篇' : journal.name : '还没有日记'}</strong><small>{journal ? `${shortDate((journal.event_time || journal.created).slice(0, 10))} · ${journal.author}` : '去日记本 ›'}</small></span></Link>
        <section className="home-desk-block home-week" aria-label="这一周">
          <div className="home-section-heading"><span className="home-kicker">THIS WEEK</span><Link href="/impressions">日回顾 ›</Link></div>
          <div className="home-week-days">{week.map(({ label, date }) => {
            const dayBuckets = buckets.some(bucket => bucketDate(bucket) === date)
            const hasReview = reviews.some(review => review.review_date === date)
            return <button key={date} type="button" className={`home-week-day ${date === today ? 'is-today' : ''} ${date > today ? 'is-future' : ''} ${date === activeDate ? 'is-selected' : ''}`} onClick={() => date === activeDate ? window.location.assign(`/impressions?date=${date}`) : setSelectedDate(date)} aria-label={`${date}${hasReview ? '，有日回顾' : ''}${dayBuckets ? '，有新记忆' : ''}`}>
              <span className="home-week-label">{label}</span><span className="home-week-number">{Number(date.slice(8, 10))}</span><span className="home-week-dots">{hasReview && <i />}{dayBuckets && <b />}</span>
            </button>
          })}</div>
          {activeBuckets.length > 0 && <div className="home-week-memory"><span>{activeDate === today ? '今天' : shortDate(activeDate)}新记忆 · </span><span>{bucketName(activeBuckets[0])}{activeBuckets.length > 1 ? ` 等 ${activeBuckets.length} 条` : ''}</span></div>}
          {activeBuckets.length === 0 && activeReview && <div className="home-week-memory">{activeDate === today ? '今天' : shortDate(activeDate)}有一篇日回顾</div>}
        </section>
        <Link href="/care" className="home-desk-block home-care"><span className="home-section-heading"><span className="home-kicker">CARE · 照顾</span><span>›</span></span>
          {upcomingReminder && <span className="home-care-row"><i />{shortDate((upcomingReminder.next_due_at || upcomingReminder.start_at || '').slice(0, 10))} {upcomingReminder.title}</span>}
          {pendingCount > 0 && <span className="home-care-row"><i />还有 {pendingCount} 件待办</span>}
          {!upcomingReminder && pendingCount === 0 && <span className="home-care-row">今天没有要记的事</span>}
        </Link>
      </div>
    </main>
    <HomeToolDrawer open={toolsOpen} onClose={() => setToolsOpen(false)} persona={persona} />
  </div>
}
