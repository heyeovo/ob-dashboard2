'use client'
import { useState, useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const TABS = [
  { slug: 'home',    label: '记忆',   href: '/memory' },
  { slug: 'review',  label: '审阅',   href: '/memory?tab=review' },
  { slug: 'chat',    label: '聊天',   href: '/' },
  { slug: 'breath',  label: 'Breath', href: '/breath-sim' },
  { slug: 'more',    label: '设置',   href: '' },
]

const MORE_ITEMS = [
  { slug: 'journal', label: '日记',      href: '/journal' },
  { slug: 'graph',   label: '关系图谱',  href: '/graph' },
  { slug: 'import',  label: '导入',      href: '/import' },
  { slug: 'trash',   label: '回收站',    href: '/trash' },
  { slug: 'prompts', label: '权重配置',  href: '/prompts' },
]

export default function BottomTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [showMore, setShowMore] = useState(false)

  const active = useCallback((slug: string) => {
    if (slug === 'home') return pathname === '/memory' && searchParams?.get('tab') !== 'review'
    if (slug === 'review') return pathname === '/memory' && searchParams?.get('tab') === 'review'
    if (slug === 'chat') return pathname === '/'
    if (slug === 'more') return false
    return pathname.startsWith(`/${slug}`)
  }, [pathname, searchParams])

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-t border-slate-100/60 pt-3"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0.5rem)' }}
      >
        <div className="flex justify-around items-start max-w-lg mx-auto" style={{ minHeight: 64 }}>
          {TABS.map(tab => {
            const isActive = active(tab.slug);

            if (tab.slug === 'more') {
              return (
                <button
                  key={tab.slug}
                  onClick={() => setShowMore(prev => !prev)}
                  className="flex flex-col items-center gap-1.5 min-w-[64px] transition-all duration-200 active:scale-90"
                >
                  <div className={`w-6 h-6 flex items-center justify-center transition-all duration-200`}>
                    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                      <circle cx="5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" />
                    </svg>
                  </div>
                  <span className="text-[11px] tracking-wide text-slate-400">{tab.label}</span>
                </button>
              )
            }

            return (
              <button
                key={tab.slug}
                onClick={() => router.push(tab.href)}
                className="flex flex-col items-center gap-1.5 min-w-[64px] transition-all duration-200 active:scale-90 group"
              >
                <div className="flex items-center justify-center w-6 h-6 transition-all duration-200">
                  {tab.slug === 'chat' ? (
                    <svg className="w-5 h-5" viewBox="0 0 20 20" fill={isActive ? '#D97757' : 'currentColor'}>
                      <path d="M2 10l1.5-1.5M5 6.5V3h2v1.5M10 2l8 8-1.5 1.5M4.5 11V18h4v-5h3v5h4V11" />
                    </svg>
                  ) : tab.slug === 'review' ? (
                    <svg className="w-5 h-5" viewBox="0 0 20 20" stroke={isActive ? '#D97757' : 'currentColor'} fill="none" strokeWidth="1.5">
                      <path d="M2 4h16M2 8h12M2 12h16M2 16h8" />
                    </svg>
                  ) : tab.slug === 'home' ? (
                    <svg className="w-5 h-5" viewBox="0 0 20 20" stroke={isActive ? '#D97757' : 'currentColor'} fill="none" strokeWidth="1.5">
                      <circle cx="10" cy="10" r="8" />
                      <line x1="10" y1="6" x2="10" y2="10" strokeWidth="1.5" />
                      <line x1="10" y1="10" x2="13" y2="12" strokeWidth="1.5" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 20 20" stroke={isActive ? '#D97757' : 'currentColor'} fill="none" strokeWidth="1.5">
                      <circle cx="10" cy="10" r="8" />
                      <line x1="10" y1="6" x2="10" y2="10" strokeWidth="1.5" />
                      <line x1="10" y1="10" x2="13" y2="12" strokeWidth="1.5" />
                    </svg>
                  )}
                </div>
                <span className={`text-[11px] tracking-wide leading-none transition-all duration-200 ${
                  isActive ? 'text-[var(--color-primary)] font-semibold' : 'text-slate-400'
                }`}>
                  {tab.label}
                </span>
                {/* Active dot indicator */}
                <div className="h-1 flex items-center justify-center">
                  <div className={`w-1 h-1 rounded-full bg-[var(--color-primary)] transition-all duration-200 ${
                    isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
                  }`} />
                </div>
              </button>
            )
          })}
        </div>
      </nav>

      {/* More popup */}
      {showMore && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setShowMore(false)} />
          <div className="fixed bottom-28 right-4 z-50 bg-white/90 backdrop-blur-md border border-slate-100/60 rounded-2xl shadow-xl overflow-hidden w-44 animate-in slide-in-from-bottom-4 duration-200">
            {MORE_ITEMS.map(item => (
              <button
                key={item.slug}
                onClick={() => { router.push(item.href); setShowMore(false) }}
                className="w-full text-left px-4 py-3 text-sm border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors text-slate-600"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
