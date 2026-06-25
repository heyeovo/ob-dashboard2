'use client'
import type { ReactNode } from 'react'

/**
 * Unified card shell — border, shadow, hover effect.
 *
 * Variants:
 *   interactive = clickable with hover lift + shadow
 *   outline    = static bordered card
 *   ghost      = no background, minimal border
 *   empty      = dashed border, for zero-state placeholders
 */
interface CardProps {
  variant?: 'interactive' | 'outline' | 'ghost' | 'empty'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
  className?: string
  children: ReactNode
}

const PADDING = {
  none: '',
  sm: 'px-3 py-2',
  md: 'px-4 py-3',
  lg: 'p-4 sm:p-5',
}

const VARIANT = {
  interactive: 'bg-white border border-[var(--color-border)] hover:shadow-md hover:border-[var(--color-primary)]/30 cursor-pointer transition-all duration-200',
  outline: 'bg-white border border-[var(--color-border)]',
  ghost: 'border border-[var(--color-border-light)] bg-[var(--color-surface-secondary)]',
  empty: 'bg-white border border-dashed border-[var(--color-border)]',
}

export default function Card({ variant = 'outline', padding = 'md', onClick, className = '', children }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl ${PADDING[padding]} ${VARIANT[variant]} ${className}`}
    >
      {children}
    </div>
  )
}
