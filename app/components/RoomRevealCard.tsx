'use client'
import Link from 'next/link'
import type { CcToolEvent } from '@/app/cc/types'
import { parseRoomReveal, roomDate } from '@/app/lib/roomTypes'
import RoomDoor from './RoomDoor'

export default function RoomRevealCard({ tool, live }: { tool: CcToolEvent; live: boolean }) {
  const reveal = parseRoomReveal(tool)
  if (!reveal) return null
  return <article className={`room-reveal${live ? ' room-reveal-live' : ''}`}>
    <header className="room-reveal-top"><div className="room-reveal-icon"><RoomDoor kind="open" /></div>
      <div className="text-2xs room-accent">房间打开了</div><h3 className="text-xl room-title mt-1">{reveal.title}</h3>
    </header>
    <div className="room-reveal-body text-sm room-prose whitespace-pre-wrap">{reveal.body}</div>
    {reveal.files.length > 0 && <div className="room-reveal-files">{reveal.files.map(file => <span className="room-pill text-meta" key={file}>{file}</span>)}</div>}
    <footer className="room-reveal-footer"><span className="text-meta room-muted">{tool.startedAt ? roomDate(new Date(tool.startedAt + (tool.durationMs || 0)).toISOString()) : '已打开'}</span><Link href={`/room/${reveal.id}`} className="text-note room-accent">去房间看看 ›</Link></footer>
  </article>
}
