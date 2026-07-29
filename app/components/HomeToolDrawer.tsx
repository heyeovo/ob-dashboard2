'use client'

import Link from 'next/link'
import { useEffect } from 'react'

const GROUPS = [
  {
    label: '概览',
    items: [{ key: 'home', label: '仪表盘', icon: '⌂', href: '/', ready: true }],
  },
  {
    label: '工具',
    items: [
      { key: 'mcp', label: '工具 · MCP', icon: '⌁', href: '/tools/mcp', ready: true },
      { key: 'usage', label: '用量统计', icon: '⌁', href: '', ready: false },
      { key: 'provider', label: 'API Provider', icon: '◇', href: '', ready: false },
    ],
  },
  {
    label: '日常',
    items: [
      { key: 'ui', label: 'UI 设置', icon: '◌', href: '', ready: false },
      { key: 'anniversary', label: '纪念日', icon: '♡', href: '', ready: false },
    ],
  },
] as const

export default function HomeToolDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭功能侧边栏"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[5px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="家的功能导航"
        className="home-nav-drawer absolute inset-y-0 left-0 flex w-[82vw] max-w-[360px] flex-col overflow-hidden border-r border-white/60 bg-[var(--color-bg)] shadow-2xl"
      >
        <header className="flex h-16 shrink-0 items-center border-b border-[var(--color-border)] bg-white/55 px-5 backdrop-blur-md">
          <span className="h-4 w-4 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#E8A58F]" />
          <div className="ml-2.5">
            <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">小言&小羊的家</h2>
            <p className="text-[10px] text-[var(--color-text-tertiary)]">功能导航</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-lg text-[var(--color-text-tertiary)] hover:bg-black/5"
          >
            ×
          </button>
        </header>

        <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {GROUPS.map(group => (
            <section key={group.label} className="mb-6">
              <h3 className="mb-2 px-3 text-[10px] font-medium tracking-[0.16em] text-[var(--color-text-disabled)]">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map(item =>
                  item.ready ? (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={onClose}
                      className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm text-[var(--color-text-secondary)] transition hover:bg-white/75 hover:text-[var(--color-primary)]"
                    >
                      <span className="flex h-7 w-7 items-center justify-center text-lg text-[var(--color-text-tertiary)]">
                        {item.icon}
                      </span>
                      <span className="font-medium">{item.label}</span>
                    </Link>
                  ) : (
                    <div
                      key={item.key}
                      aria-disabled="true"
                      className="flex cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-3 text-sm text-[var(--color-text-disabled)]"
                    >
                      <span className="flex h-7 w-7 items-center justify-center text-lg">{item.icon}</span>
                      <span>{item.label}</span>
                      <span className="ml-auto text-[9px]">以后</span>
                    </div>
                  ),
                )}
              </div>
            </section>
          ))}
        </nav>
      </aside>
    </div>
  )
}
