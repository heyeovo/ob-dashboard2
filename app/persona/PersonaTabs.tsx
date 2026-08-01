'use client'

import Link from 'next/link'

export type PersonaTab = 'state' | 'portrait'

const TABS: Array<{ id: PersonaTab; label: string; href: string }> = [
  { id: 'state', label: '内在状态', href: '/persona?tab=state' },
  { id: 'portrait', label: '画像', href: '/persona?tab=portrait' },
]

/** Persona 页共享 tab 导航（内在状态 / 画像） */
export default function PersonaTabs({ active }: { active: PersonaTab }) {
  return (
    <nav className="mb-5 flex gap-1 rounded-xl bg-[var(--color-surface-secondary)] p-1 text-sm">
      {TABS.map(tab => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`rounded-lg px-4 py-2 transition ${
            tab.id === active
              ? 'bg-white font-medium text-[var(--color-text-heading)] shadow-sm'
              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
