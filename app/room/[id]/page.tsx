'use client'
import { use, useEffect, useState } from 'react'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import RoomDoor from '@/app/components/RoomDoor'
import RoomVisitProcess from '@/app/components/RoomVisitProcess'
import RoomFilePreview from '@/app/components/RoomFilePreview'
import CcMarkdown from '@/app/cc/CcMarkdown'
import { roomDate, roomDuration, type Room, type RoomFile } from '@/app/lib/roomTypes'

export default function RoomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [room, setRoom] = useState<Room | null>(null)
  const [files, setFiles] = useState<RoomFile[]>([])
  const [file, setFile] = useState<RoomFile | null>(null)
  const [error, setError] = useState('')
  const [fileError, setFileError] = useState('')
  const [openVisits, setOpenVisits] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let active = true
    setRoom(null); setError(''); setFiles([]); setFileError(''); setOpenVisits({}); setFile(null)
    void fetch(`/api/rooms/${encodeURIComponent(id)}`, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? '找不到这间房间' : '暂时无法读取房间')
      const data: Room = await response.json()
      if (!active) return
      setRoom(data)
      if (data.status === 'opened') {
        try {
          const response = await fetch(`/api/rooms/${encodeURIComponent(id)}/files`, { cache: 'no-store' })
          if (!response.ok) throw new Error('暂时无法读取房间文件')
          const payload = await response.json()
          if (active) setFiles(payload.files || [])
        } catch (e) { if (active) setFileError((e as Error).message) }
      }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [id])
  useEffect(() => {
    if (!room) return
    const revealHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1))
      if (!hash.startsWith('visit-')) return
      if (room.status === 'closed') document.getElementById('room-door')?.scrollIntoView({ block: 'center' })
      else {
        setOpenVisits(previous => ({ ...previous, [hash.slice(6)]: true }))
        requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'center' }))
      }
    }
    revealHash(); window.addEventListener('hashchange', revealHash)
    return () => window.removeEventListener('hashchange', revealHash)
  }, [room])
  return <main className="room-page min-h-screen"><SubpageBackButton label="返回房间" href="/room" />
    {!room ? <p className="text-sm room-muted mt-8">{error || '正在看门牌…'}</p> : room.status === 'closed' ? <div className="room-closed" id="room-door">
      <RoomDoor kind={room.lock_until ? 'locked' : 'closed'} large /><h1 className="text-xl room-title mt-6">{room.title}</h1>
      <p className="text-note room-secondary mt-2">门还关着。{room.lock_until && <><br />锁到 {roomDate(room.lock_until, 'full')}。</>}</p>
      <p className="text-xs room-muted mt-4">他来过 {room.visit_count} 次{room.last_visit ? `，最近一次是 ${roomDate(room.last_visit, 'full')}，待了 ${roomDuration(room.last_visit_duration_ms || 0)}。` : '。'}</p>
    </div> : <>
      <div className="room-kicker text-2xs">OPENED · {roomDate(room.opened_at, 'full')} 打开</div><h1 className="text-3xl room-title mt-1">{room.title}</h1>
      <p className="text-xs room-muted mt-1">写于 {roomDate(room.created_at, 'full').split(' ')[0]} · 来过 {room.visit_count} 次 · 共 {roomDuration(room.total_duration_ms)}</p>
      <article className="room-paper">{room.entries?.map((entry, index) => <section key={entry.id} className="room-entry"><div className="text-2xs room-muted mb-3">#{index + 1} · {roomDate(entry.created_at)}</div><div className="room-prose text-md"><CcMarkdown text={entry.content} /></div></section>)}{!room.entries?.length && <p className="text-sm room-muted">还没有写下的文字</p>}</article>
      <div className="room-section"><span className="room-kicker text-2xs">FILES · 房间里的东西</span></div>
      <div className="flex flex-col gap-2 mt-3">{files.map(item => <button type="button" key={item.name} className="room-file" onClick={() => setFile(item)}><span className="room-file-icon text-3xs">{item.name.split('.').pop()?.toUpperCase()}</span><span className="flex-1 min-w-0 text-left text-sm break-all">{item.name}<small className="block text-meta room-muted">{item.size < 1024 ? `${item.size} 字节` : `${(item.size / 1024).toFixed(1)} KB`}</small></span><span className="text-xs room-accent">{/\.html?$/i.test(item.name) ? '打开' : '查看'} ›</span></button>)}{!files.length && <p className="text-xs room-muted">{fileError || '暂无文件'}</p>}</div>
      <div className="room-section"><span className="room-kicker text-2xs">VISITS · 当时</span></div>
      <div className="room-group mt-3">{[...(room.visits || [])].sort((a, b) => a.entered_at.localeCompare(b.entered_at)).map(visit => <section key={visit.id} id={`visit-${visit.id}`} className="room-visit-record"><button className="room-visit-toggle text-note" aria-expanded={!!openVisits[visit.id]} onClick={() => setOpenVisits(previous => ({ ...previous, [visit.id]: !previous[visit.id] }))}><span>{roomDate(visit.entered_at)} · 待了 {roomDuration(visit.duration_ms)}{visit.turn_kind === 'agent_wake' ? ' · 唤醒时' : ''}</span><span className="text-xs room-muted flex items-center gap-2">{openVisits[visit.id] ? '收起' : '展开'}<i className={`cc-fold-caret${openVisits[visit.id] ? ' open' : ''}`} /></span></button>{openVisits[visit.id] && <RoomVisitProcess process={visit.process || []} />}</section>)}{!room.visits?.length && <p className="py-3 text-xs room-muted">还没有来访记录</p>}</div>
    </>}
    {file && <RoomFilePreview roomId={id} file={file} onClose={() => setFile(null)} />}
  </main>
}
