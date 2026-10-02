'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import Card from '@/app/components/Card'
import RoomDoor from '@/app/components/RoomDoor'
import { ROOM_LAST_SEEN, roomDate, roomDuration, roomVisitHref, type Room, type RoomVisit } from '@/app/lib/roomTypes'

const PAGE_SIZE = 50
export default function RoomPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [visits, setVisits] = useState<RoomVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [more, setMore] = useState(true)
  const [paging, setPaging] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try { localStorage.setItem(ROOM_LAST_SEEN, new Date().toISOString()) } catch {}
    let active = true
    void Promise.all(['/api/rooms', `/api/rooms/visits?limit=${PAGE_SIZE}`].map(async url => {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('暂时无法读取房间')
      return response.json()
    })).then(([doors, history]) => {
      if (!active) return
      setRooms(doors.rooms || []); setVisits(history.visits || []); setMore(history.visits?.length === PAGE_SIZE)
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (loading || !more || paging || error || !sentinel.current || !visits.length) return
    const observer = new IntersectionObserver(entries => {
      const hashTarget = decodeURIComponent(window.location.hash.slice(1))
      if (!entries.some(entry => entry.isIntersecting) && (!hashTarget || visits.some(v => `visit-${v.id}` === hashTarget))) return
      setPaging(true)
      const before = visits.at(-1)!.entered_at
      void fetch(`/api/rooms/visits?limit=${PAGE_SIZE}&before=${encodeURIComponent(before)}`, { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error('来访记录读取失败')
        return response.json()
      }).then(data => {
        const next: RoomVisit[] = data.visits || []
        setVisits(previous => [...previous, ...next.filter(v => !previous.some(old => old.id === v.id))])
        setMore(next.length === PAGE_SIZE)
      }).catch(e => setError(e.message)).finally(() => setPaging(false))
    }, { rootMargin: '300px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [loading, more, paging, visits, error])
  useEffect(() => {
    const target = decodeURIComponent(window.location.hash.slice(1))
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'center' })
  }, [visits])
  const ordered = [...rooms].sort((a, b) => a.status !== b.status ? a.status === 'closed' ? -1 : 1 : (b.status === 'closed' ? b.last_visit : b.opened_at).localeCompare(a.status === 'closed' ? a.last_visit : a.opened_at))
  const groups = Map.groupBy(visits, visit => roomDate(visit.entered_at, 'day'))
  const today = roomDate(new Date().toISOString(), 'day')
  return <main className="room-page room-list-page min-h-screen">
    <SubpageBackButton label="返回主页" href="/" /><div className="room-kicker text-2xs">ROOMS · 言之的房间</div><h1 className="room-title text-3xl mt-1">房间</h1><p className="text-xs room-muted mt-1">他自己的地方。门开了你才看得到里面。</p>
    {loading ? <p className="text-sm room-muted mt-8">正在看门牌…</p> : error && !rooms.length ? <p className="text-sm room-muted mt-8">{error}</p> : !rooms.length ? <div className="room-empty"><RoomDoor kind="closed" large /><p className="text-sm room-muted">还没有房间</p></div> : <>
      <div className="room-grid">{ordered.map(room => <Link key={room.id} href={`/room/${room.id}`}>
        <Card variant="interactive" className="room-card"><RoomDoor kind={room.status === 'opened' ? 'open' : room.lock_until ? 'locked' : 'closed'} />
          <h2 className="room-title text-md font-semibold">{room.title}</h2><p className="text-meta room-muted mt-1">来过 {room.visit_count} 次 · 共 {roomDuration(room.total_duration_ms)}</p>
          <span className={`room-pill text-2xs${room.status === 'opened' ? ' room-pill-open' : ''}`}>{room.status === 'opened' ? `${roomDate(room.opened_at).slice(0, 5)} 打开` : room.lock_until ? `锁到 ${roomDate(room.lock_until)}` : '关着'}</span>
        </Card></Link>)}</div>
      <div className="room-section"><span className="room-kicker text-2xs">VISITS · 进出</span><span className="text-2xs room-muted">共 {rooms.reduce((sum, room) => sum + room.visit_count, 0)} 次</span></div>
      {[...groups].map(([day, items]) => <section key={day}><h2 className="text-meta room-muted mt-4">{Number(day.slice(5, 7))}月{Number(day.slice(8, 10))}日{day === today ? ' · 今天' : ''}</h2><div className="room-group mt-2">{items.map(visit => <Link className="room-visit" key={visit.id} id={`visit-${visit.id}`} href={roomVisitHref(visit.room_id, visit.id)}>
        <time className="text-note">{roomDate(visit.entered_at, 'time')}</time><i className={`room-visit-dot${visit.turn_kind === 'agent_wake' ? ' wake' : ''}`} /><span className="text-sm">进了「{visit.room_title}」<small className="block text-meta room-muted">待了 {roomDuration(visit.duration_ms)}{visit.turn_kind === 'agent_wake' ? ' · 唤醒时' : ''}</small></span>
      </Link>)}</div></section>)}
      {error && <p className="text-xs room-muted mt-4">{error}</p>}
      <div ref={sentinel} className="py-4 text-xs room-muted">{paging ? '正在读取更多…' : !visits.length ? '还没有来访' : ''}</div>
    </>}
  </main>
}
