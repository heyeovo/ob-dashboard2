'use client'
import Link from 'next/link'

interface NavBarProps {
  activeSlug: string
  onTabClick?: (tab: string) => void  // only used by main page for router.replace
}

const TAB_LINKS = [
  { slug: 'timeline', href: '/memory?tab=timeline', label: '时间线' },
  { slug: 'grid', href: '/memory?tab=grid', label: '记忆格' },
  { slug: 'review', href: '/memory?tab=review', label: '审阅' },
] as const

const PAGE_LINKS = [
  { slug: 'chat', href: '/', label: '聊天' },
  { slug: 'cc', href: '/cc', label: 'cc 聊天' },
  { slug: 'breath-sim', href: '/breath-sim', label: '模拟 Breath' },
  { slug: 'graph', href: '/graph', label: '关系图谱' },
  { slug: 'journal', href: '/journal', label: '日记' },
  { slug: 'import', href: '/import', label: '导入' },
  { slug: 'trash', href: '/trash', label: '回收站' },
  { slug: 'prompts', href: '/prompts', label: '权重配置' },
] as const

export default function NavBar({ activeSlug, onTabClick }: NavBarProps) {
  return (
    <nav className="hidden md:block border-b border-[var(--color-border)] bg-white/50 backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5 md:gap-8 text-xs sm:text-sm font-medium text-[var(--color-text-tertiary)]">
        {/* Logo */}
        <Link
          href="/"
          className="text-[var(--color-text-primary)] font-semibold flex items-center gap-1.5 sm:gap-2 mr-1 sm:mr-4"
        >
          <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#E8A58F]" />
          <span className="text-xs sm:text-sm">Ombre Brain</span>
        </Link>

        {/* Tab links (timeline / grid / review) */}
        {TAB_LINKS.map(t =>
          onTabClick ? (
            <span
              key={t.slug}
              onClick={() => onTabClick(t.slug)}
              className={`cursor-pointer transition-colors h-full flex items-center whitespace-nowrap ${
                activeSlug === t.slug
                  ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-primary)]'
                  : 'hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t.label}
            </span>
          ) : (
            <Link
              key={t.slug}
              href={t.href}
              className={`cursor-pointer transition-colors h-full flex items-center whitespace-nowrap ${
                activeSlug === t.slug
                  ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-primary)]'
                  : 'hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t.label}
            </Link>
          )
        )}

        {/* Page links */}
        {PAGE_LINKS.map(p =>
          p.slug === activeSlug ? (
            <span
              key={p.slug}
              className="text-[var(--color-text-primary)] border-b-2 border-[var(--color-primary)] h-full flex items-center whitespace-nowrap"
            >
              {p.label}
            </span>
          ) : (
            <Link
              key={p.slug}
              href={p.href}
              className="hover:text-[var(--color-text-primary)] cursor-pointer transition-colors h-full flex items-center whitespace-nowrap"
            >
              {p.label}
            </Link>
          )
        )}
      </div>
    </nav>
  )
}
