'use client'
import { useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'

// 4.6 导航重构后的 5 Tab（用户自己定的顺序）：
//   Home / 记忆库 / 聊天(cc，中间突起) / 工作台+调参 / 设置
// 「设置」从弹出菜单改成一个真正的页面（/settings），次级入口都收在那里和 Home 里。
const TABS = [
  { slug: 'home',      label: '主页',   href: '/' },
  { slug: 'memory',    label: '记忆库', href: '/memory' },
  { slug: 'cc',        label: '聊天',   href: '/cc' },
  { slug: 'workbench', label: '工作台', href: '/workbench' },
  { slug: 'settings',  label: '设置',   href: '/settings' },
]

function TabIcon({ slug, active }: { slug: string; active: boolean }) {
  const stroke = active ? 'var(--color-primary)' : 'currentColor'
  const p = { className: 'w-5 h-5', viewBox: '0 0 20 20', fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (slug) {
    case 'home':
      return <svg {...p}><path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1V8.5Z" /></svg>
    case 'memory':
      return <svg {...p}><circle cx="10" cy="10" r="7" /><path d="M10 5.5v4.5l3 2" /></svg>
    case 'workbench':
      return <svg {...p}><path d="M3 12h14M5.5 12V8.5m4 3.5v-6m4 6V9.5M3 16h14" /></svg>
    case 'settings':
      return <svg {...p}><circle cx="10" cy="10" r="2.5" /><path d="M10 3v2m0 10v2M3 10h2m10 0h2M5.4 5.4l1.4 1.4m6.4 6.4 1.4 1.4m0-9.2-1.4 1.4m-6.4 6.4-1.4 1.4" /></svg>
    default:
      return null
  }
}

export default function BottomTabBar() {
  const router = useRouter()
  const pathname = usePathname() || '/'

  const active = useCallback((slug: string) => {
    if (slug === 'home') return pathname === '/'
    if (slug === 'memory') return pathname === '/memory' || pathname.startsWith('/bucket')
    return pathname.startsWith(`/${slug}`)
  }, [pathname])

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-100/60 bg-white/80 pt-3 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0.5rem)' }}
    >
      <div className="mx-auto flex max-w-lg items-start justify-around" style={{ minHeight: 64 }}>
        {TABS.map(tab => {
          const isActive = active(tab.slug)

          // 中间那格：聊天，圆形突起（新架构里聊天是中心）
          if (tab.slug === 'cc') {
            return (
              <button
                key={tab.slug}
                onClick={() => router.push(tab.href)}
                className="flex min-w-[64px] flex-col items-center gap-1 transition-all duration-200 active:scale-90"
              >
                <div
                  className={`-mt-4 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-gradient)]'
                      : 'bg-gradient-to-br from-[var(--color-primary)]/85 to-[var(--color-primary-gradient)]/85'
                  }`}
                >
                  <svg className="h-6 w-6" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.5 9.5c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5S13.6 15 10 15c-.8 0-1.6-.1-2.3-.3L4 16l.9-2.6c-.9-1-1.4-2.3-1.4-3.9Z" />
                  </svg>
                </div>
                <span className={`text-[11px] leading-none tracking-wide ${
                  isActive ? 'font-semibold text-[var(--color-primary)]' : 'text-slate-400'
                }`}>
                  {tab.label}
                </span>
              </button>
            )
          }

          return (
            <button
              key={tab.slug}
              onClick={() => router.push(tab.href)}
              className="group flex min-w-[64px] flex-col items-center gap-1.5 transition-all duration-200 active:scale-90"
            >
              <div className="flex h-6 w-6 items-center justify-center text-slate-400 transition-all duration-200">
                <TabIcon slug={tab.slug} active={isActive} />
              </div>
              <span className={`text-[11px] leading-none tracking-wide transition-all duration-200 ${
                isActive ? 'font-semibold text-[var(--color-primary)]' : 'text-slate-400'
              }`}>
                {tab.label}
              </span>
              {/* Active dot indicator */}
              <div className="flex h-1 items-center justify-center">
                <div className={`h-1 w-1 rounded-full bg-[var(--color-primary)] transition-all duration-200 ${
                  isActive ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                }`} />
              </div>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
