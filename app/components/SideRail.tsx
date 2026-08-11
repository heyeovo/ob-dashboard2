'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * 桌面端左侧竖排导航（4.6 导航重构）。
 *
 * 取代原来的顶部横条 NavBar：聊天页本来要一列会话列表，顶上再压一条横条会把对话区切矮。
 * 竖栏和会话列表并排是连续的两列。
 *
 * 上半段 = 手机端底部 5 Tab 的同一批入口（一套路由，两套外壳）。
 * 下半段 = 手机端收在 Home 汉堡里的次级入口，桌面端常驻。
 */

type Item = { slug: string; href: string; label: string; icon: 'home' | 'memory' | 'chat' | 'workbench' | 'settings' | 'polaris' | 'journal' | 'journey' }

const PRIMARY: Item[] = [
  { slug: 'home', href: '/', label: '主页', icon: 'home' },
  { slug: 'memory', href: '/memory', label: '记忆库', icon: 'memory' },
  { slug: 'cc', href: '/cc', label: '聊天', icon: 'chat' },
  { slug: 'workbench', href: '/workbench', label: '工作台', icon: 'workbench' },
  { slug: 'settings', href: '/settings', label: '设置', icon: 'settings' },
]

const SECONDARY: Item[] = [
  { slug: 'polaris', href: '/polaris', label: 'Polaris', icon: 'polaris' },
  { slug: 'journal', href: '/journal', label: '日记', icon: 'journal' },
  { slug: 'journey', href: '/journey', label: '轨迹', icon: 'journey' },
]

function Icon({ name }: { name: Item['icon'] }) {
  const common = { className: 'w-5 h-5', viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1V8.5Z" /></svg>
    case 'memory':
      return <svg {...common}><circle cx="10" cy="10" r="7" /><path d="M10 5.5v4.5l3 2" /></svg>
    case 'chat':
      return <svg {...common}><path d="M3.5 9.5c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5S13.6 15 10 15c-.8 0-1.6-.1-2.3-.3L4 16l.9-2.6c-.9-1-1.4-2.3-1.4-3.9Z" /></svg>
    case 'workbench':
      return <svg {...common}><path d="M3 12h14M5.5 12V8.5m4 3.5v-6m4 6V9.5M3 16h14" /></svg>
    case 'settings':
      return <svg {...common}><circle cx="10" cy="10" r="2.5" /><path d="M10 3v2m0 10v2M3 10h2m10 0h2M5.4 5.4l1.4 1.4m6.4 6.4 1.4 1.4m0-9.2-1.4 1.4m-6.4 6.4-1.4 1.4" /></svg>
    case 'polaris':
      return <svg {...common}><path d="M10 3l1.8 4.5L16.5 9l-4.7 1.5L10 15l-1.8-4.5L3.5 9l4.7-1.5L10 3Z" /></svg>
    case 'journal':
      return <svg {...common}><path d="M5 3.5h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5V3.5Z" /><path d="M5 3.5a1.5 1.5 0 0 0 0 3M8 8h4M8 11h4" /></svg>
    case 'journey':
      return <svg {...common}><circle cx="5" cy="15" r="1.5" /><circle cx="15" cy="5" r="1.5" /><path d="M6.3 13.8c1.5-1.2 1.4-3.1 3-4.2 1.4-1 2.8-.8 4.4-3.3" /></svg>
  }
}

export default function SideRail() {
  const pathname = usePathname() || '/'

  const isActive = (slug: string) => {
    if (slug === 'home') return pathname === '/'
    if (slug === 'memory') return pathname === '/memory' || pathname.startsWith('/bucket')
    return pathname.startsWith(`/${slug}`)
  }

  const cell = (item: Item, small = false) => {
    const active = isActive(item.slug)
    return (
      <Link
        key={item.slug}
        href={item.href}
        title={item.label}
        className={`relative flex w-14 flex-col items-center gap-1 rounded-xl py-2 transition-colors ${
          active
            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
            : 'text-[var(--color-text-tertiary)] hover:bg-black/[0.03] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Icon name={item.icon} />
        <span className={`leading-none tracking-wide ${small ? 'text-[9px]' : 'text-[10px]'} ${active ? 'font-semibold' : ''}`}>
          {item.label}
        </span>
        {active && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-primary)]" />}
      </Link>
    )
  }

  return (
    <nav className="fixed left-0 top-0 z-30 hidden h-screen w-[68px] flex-col items-center border-r border-[var(--color-border)] bg-white/70 py-3 backdrop-blur-md md:flex">
      <Link href="/" title="Ombre Brain" className="mb-3 flex h-9 w-9 items-center justify-center">
        <span className="h-4 w-4 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#E8A58F]" />
      </Link>

      <div className="flex flex-col items-center gap-1">{PRIMARY.map(i => cell(i))}</div>

      <div className="flex-1" />

      <div className="mb-1 h-px w-8 bg-[var(--color-border)]" />
      <div className="flex flex-col items-center gap-1">{SECONDARY.map(i => cell(i, true))}</div>
    </nav>
  )
}
