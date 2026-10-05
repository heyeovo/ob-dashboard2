'use client'

import BodyPortal from '@/app/components/BodyPortal'
import Link from 'next/link'
import { useEffect } from 'react'

const rooms = [
  { label: '游戏室', href: '/games' },
  { label: '关系轨迹', href: '/journey' },
  { label: '关系图谱', href: '/graph' },
]

export default function HomeToolDrawer({ open, onClose, persona }: { open: boolean; onClose: () => void; persona: { id?: string; name?: string; initial?: string } }) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open) return null
  return <BodyPortal><div className="fixed inset-0 z-50">
    <button type="button" aria-label="关闭家的其他房间" onClick={onClose} className="absolute inset-0 bg-[var(--color-overlay)]/20" />
    <aside role="dialog" aria-modal="true" aria-label="家里的其他房间" className="home-nav-drawer float-surface absolute inset-y-0 left-0 w-[74vw] max-w-[360px] overflow-y-auto px-5 pt-[calc(env(safe-area-inset-top,0px)+2rem)] shadow-2xl">
      <button type="button" onClick={onClose} aria-label="关闭" className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1.25rem)] flex h-11 w-11 items-center justify-center text-xl text-[var(--color-text-tertiary)]">×</button>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--color-text-heading)]">家里的其他房间</h2>
      <p className="mt-1 mb-5 text-3xs tracking-[0.2em] text-[var(--color-text-tertiary)]">ROOMS</p>
      {/* 言之的房间：提示词页（原来在聊天页 ··· 菜单里） */}
      <Link href={`/collaborators/${encodeURIComponent(persona.id || 'ombre')}`} onClick={onClose} className="home-room-persona mb-4 flex items-center gap-3 rounded-[var(--radius-2xl)] p-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--color-on-primary)]" aria-hidden="true">{persona.initial || persona.name?.slice(0, 1) || '言'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-[family-name:var(--font-display)] text-md font-semibold text-[var(--color-text-heading)]">{persona.name || '言之'}</span>
          <span className="mt-0.5 block text-2xs text-[var(--color-text-tertiary)]">提示词</span>
        </span>
        <span className="text-[var(--color-text-tertiary)]">›</span>
      </Link>
      <nav>{rooms.map(room => <Link key={room.href} href={room.href} onClick={onClose} className="flex min-h-12 items-center justify-between border-t border-[var(--color-border-subtle)] text-sm text-[var(--color-text-primary)]"><span>{room.label}</span><span className="text-[var(--color-text-tertiary)]">›</span></Link>)}</nav>
    </aside>
  </div></BodyPortal>
}
