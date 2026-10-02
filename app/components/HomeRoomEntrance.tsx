'use client'
import Link from 'next/link'
import HomeSillArt from './HomeSillArt'
import { useEffect, useState } from 'react'
import { ROOM_LAST_SEEN, roomHasNewVisit } from '@/app/lib/roomTypes'

export default function HomeRoomEntrance({ onCard }: { onCard: boolean }) {
  const [newVisit, setNewVisit] = useState(false)
  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/rooms', { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        let seen: string | null = null
        try { seen = localStorage.getItem(ROOM_LAST_SEEN) } catch {}
        if (mounted) setNewVisit(roomHasNewVisit(data.rooms || [], seen))
      } catch {}
    }
    void refresh()
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { mounted = false; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  return <Link href="/room" aria-label="言之的房间" className={`home-room-entrance${onCard ? ' on-card' : ''}`}>
    <HomeSillArt kind="clawd" />
    {newVisit && <i className="home-room-dot" aria-hidden="true" />}
  </Link>
}
