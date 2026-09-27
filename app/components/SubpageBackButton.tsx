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

  if (href) {
    return <Link href={href} aria-label={label} className={classes}><span aria-hidden="true">‹</span></Link>
  }

  return <button type="button" onClick={onClick} aria-label={label} className={classes}><span aria-hidden="true">‹</span></button>
}
