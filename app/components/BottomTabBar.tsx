'use client'
import { useState, useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const TABS = [
  { slug: 'review',  label: '审阅',  href: '/?tab=review' },
  { slug: 'journal', label: '日记',  href: '/journal' },
  { slug: 'home',    label: '记忆',  href: '/' },
  { slug: 'breath',  label: 'Breath', href: '/breath-sim' },
  { slug: 'more',    label: '设置',  href: '' },
]

const MORE_ITEMS = [
  { slug: 'graph',   label: '关系图谱',  href: '/graph' },
  { slug: 'import',  label: '导入',     href: '/import' },
  { slug: 'trash',   label: '回收站',   href: '/trash' },
  { slug: 'prompts', label: '权重配置',  href: '/prompts' },
]

export default function BottomTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [showMore, setShowMore] = useState(false)

  const currentTab = useMemo(() => {
    const tab = searchParams?.get('tab')
    if (tab === 'review') return 'review'
    return null
  }, [searchParams])

  const active = useCallback((slug: string) => {
    if (slug === 'home') return pathname === '/'
    if (slug === 'review') return pathname === '/' && currentTab === 'review'
    if (slug === 'more') return false
    return pathname.startsWith(`/${slug}`)
  }, [pathname, currentTab])

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-slate-100 pb-7"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 1.75rem)' }}
      >
        <div className="flex justify-around items-center h-14 max-w-lg mx-auto">
          {TABS.map(tab => {
            const isActive = active(tab.slug);

            if (tab.slug === 'more') {
              return (
                <button
                  key={tab.slug}
                  onClick={() => setShowMore(prev => !prev)}
                  className={`flex flex-col items-center gap-1 min-w-[56px] transition-colors duration-150 ${
                    isActive ? 'text-[#2D2A4A] font-semibold' : 'text-slate-400'
                  }`}
                >
                  <div className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors duration-150 ${
                    isActive ? 'bg-purple-50/60' : ''
                  }`}>
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <circle cx="5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" />
                    </svg>
                  </div>
                  <span className="text-[11px] leading-none">{tab.label}</span>
                </button>
              )
            }

            return (
              <button
                key={tab.slug}
                onClick={() => router.push(tab.href)}
                className={`flex flex-col items-center gap-1 min-w-[56px] transition-colors duration-150 ${
                  isActive ? 'text-[#2D2A4A] font-semibold' : 'text-slate-400'
                }`}
              >
                {/* Icon with halo */}
                <div className={`flex items-center justify-center rounded-full transition-all duration-200 ${
                  isActive ? 'bg-purple-50/60 p-1.5' : 'p-1.5'
                }`}>
                  {tab.slug === 'home' ? (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 10l1.5-1.5M5 6.5V3h2v1.5M10 2l8 8-1.5 1.5M4.5 11V18h4v-5h3v5h4V11" />
                    </svg>
                  ) : tab.slug === 'review' ? (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 4h16M2 8h12M2 12h16M2 16h8" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  ) : tab.slug === 'journal' ? (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="3" y="2" width="14" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="7" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1" />
                      <line x1="7" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="10" y1="6" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="10" y1="10" x2="13" y2="12" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  )}
                </div>
                <span className="text-[11px] leading-none">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* More popup */}
      {showMore && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setShowMore(false)} />
          <div className="fixed bottom-24 right-4 z-50 bg-white border border-slate-100 rounded-2xl shadow-xl overflow-hidden w-44 animate-in slide-in-from-bottom-4 duration-200">
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
