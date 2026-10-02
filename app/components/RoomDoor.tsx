'use client'
import { useId } from 'react'

export default function RoomDoor({ kind, large = false }: { kind: 'closed' | 'locked' | 'open'; large?: boolean }) {
  const id = useId().replaceAll(':', '')
  return <svg viewBox="0 0 100 132" className={`room-door-svg${large ? ' room-door-large' : ''}`} aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-light`} cx="50%" cy="78%" r="70%"><stop offset="0" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity=".55" /><stop offset=".55" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity=".18" /><stop offset="1" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity=".35" /><stop offset="1" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-slit`}><stop offset="0" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity="0" /><stop offset=".5" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity=".7" /><stop offset="1" style={{ stopColor: 'var(--room-door-light)' }} stopOpacity="0" /></linearGradient>
    </defs>
    <g style={{ stroke: 'var(--color-border)', strokeWidth: 1, fill: 'none' }}>
      <path d="M8 122V50a42 42 0 0 1 84 0v72" style={{ fill: 'var(--room-door-inset)' }} strokeWidth="1.2" />
      <path d="M4 122h92" strokeWidth="2.2" strokeLinecap="round" /><path d="M50 6v4" />
      {kind === 'open' ? <>
        <path d="M15 122V52a35 35 0 0 1 70 0v70z" fill={`url(#${id}-light)`} stroke="none" />
        <path d="M28 122L72 122L96 132L4 132Z" fill={`url(#${id}-floor)`} stroke="none" />
        <path d="M15 122V52Q15 26 30 19V114Z" style={{ fill: 'var(--room-door-fill)' }} />
        <path d="M19 112V84M19 76V52" /><circle cx="26.5" cy="88" r="1.9" style={{ fill: 'var(--room-door-light)' }} stroke="none" />
      </> : <>
        <path d="M15 122V52a35 35 0 0 1 70 0v70z" style={{ fill: 'var(--room-door-fill)' }} />
        <path d="M25 74V57a25 25 0 0 1 50 0v17z" /><path d="M29 72V58a21 21 0 0 1 42 0v14z" style={{ fill: 'var(--room-door-inset)' }} stroke="none" />
        <rect x="25" y="82" width="21" height="32" rx="2" /><rect x="54" y="82" width="21" height="32" rx="2" />
        <rect x="74.5" y="86" width="5" height="14" rx="2.5" style={{ fill: 'var(--room-door-inset)' }} stroke="none" /><circle cx="77" cy="90.5" r="2.4" style={{ fill: 'var(--color-text-tertiary)' }} stroke="none" />
        {kind === 'locked' && <>
          <circle cx="77" cy="96" r="1.1" style={{ fill: 'var(--color-text-secondary)' }} stroke="none" /><path d="M76.4 96.6h1.2l.4 2.2h-2z" style={{ fill: 'var(--color-text-secondary)' }} stroke="none" />
          <g transform="translate(43 60)" style={{ stroke: 'var(--color-text-tertiary)' }}><rect x="0" y="5" width="14" height="10" rx="2" style={{ fill: 'var(--room-door-fill)' }} /><path d="M3 5V3a4 4 0 0 1 8 0v2" /></g>
        </>}
        {large && <rect x="20" y="120.6" width="60" height="1.6" rx=".8" fill={`url(#${id}-slit)`} stroke="none" />}
      </>}
    </g>
  </svg>
}
