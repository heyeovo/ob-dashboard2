'use client'

import Link from 'next/link'

type Props = {
  label: string
  href?: string
  onClick?: () => void
  className?: string
}

export default function SubpageBackButton({ label, href, onClick, className = '' }: Props) {
  const classes = `subpage-back-button inline-flex ${className}`.trim()
  const icon = <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12.5 4.5-5.5 5.5 5.5 5.5" /></svg>

  if (href) {
    return <Link href={href} aria-label={label} className={classes}>{icon}</Link>
  }

  return <button type="button" onClick={onClick} aria-label={label} className={classes}>{icon}</button>
}
