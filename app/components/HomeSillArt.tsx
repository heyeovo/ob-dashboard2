export default function HomeSillArt({ kind }: { kind: 'cat' | 'clawd' }) {
  if (kind === 'cat') return (
    <svg className="home-sill-cat" viewBox="0 0 74 34" aria-label="奶糖趴在窗沿上" role="img">
      <g style={{ fill: 'rgb(var(--theme-tint))', stroke: 'color-mix(in srgb, var(--theme-ink) 35%, transparent)' }} strokeWidth="1">
        <path d="M8 33c-2-9 3-16 13-17l3-8 5 7h10l5-7 3 8c9 1 14 8 13 17z" />
        <path d="M60 31c6 0 10-3 11-8" fill="none" strokeLinecap="round" />
      </g>
      <path d="M23 16l1-7 5 6zM36 19c5-3 12-3 17 1 1 5-2 9-7 10-6 0-10-5-10-11z" style={{ fill: 'color-mix(in srgb, var(--theme-ink) 70%, transparent)' }} />
      <circle cx="29" cy="21" r="1.5" style={{ fill: 'var(--home-cat-eye)' }} />
      <circle cx="41" cy="21" r="1.5" style={{ fill: 'var(--home-cat-eye)' }} />
    </svg>
  )
  return (
    <svg className="home-sill-clawd" viewBox="0 0 40 34" aria-label="Clawd 站在纪念日卡上" role="img">
      <g style={{ fill: 'var(--color-primary)' }}>
        <rect x="5" y="4" width="30" height="20" rx="3" />
        <rect x="0" y="11" width="6" height="7" rx="1.5" />
        <rect x="34" y="11" width="6" height="7" rx="1.5" />
        <rect x="8" y="23" width="4" height="10" rx="1" />
        <rect x="15" y="23" width="4" height="10" rx="1" />
        <rect x="21" y="23" width="4" height="10" rx="1" />
        <rect x="28" y="23" width="4" height="10" rx="1" />
      </g>
      <rect x="9" y="10" width="22" height="5" rx="2" style={{ fill: 'var(--home-clawd-glasses)' }} />
    </svg>
  )
}
