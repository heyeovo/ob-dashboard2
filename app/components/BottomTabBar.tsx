'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ccReturnHref } from '@/app/cc/ccNavMemory'

// 4.6 导航重构后的 5 Tab（用户自己定的顺序）：
//   Home / 记忆库 / 聊天 / 工作台+调参 / 设置
// 2026-09-30 改成满宽只留图标（label 只作读屏用），当前页由 .tab-pill 淡底标出，聊天不再突起
// 「设置」从弹出菜单改成一个真正的页面（/settings），次级入口都收在那里和 Home 里。
const TABS = [
  { slug: 'home',      label: '主页',   href: '/' },
  { slug: 'memory',    label: '记忆库', href: '/memory' },
  { slug: 'cc',        label: '聊天',   href: '/cc' },
  { slug: 'workbench', label: '工作台', href: '/workbench' },
  { slug: 'settings',  label: '设置',   href: '/settings' },
]

function TabIcon({ slug }: { slug: string }) {
  const p = { className: 'h-[22px] w-[22px]', viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (slug) {
    case 'home':
      return <svg {...p}><path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1V8.5Z" /></svg>
    case 'memory':
      return <svg {...p}><circle cx="10" cy="10" r="7" /><path d="M10 5.5v4.5l3 2" /></svg>
    case 'cc':
      return <svg {...p}><path d="M3.5 9.5c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5S13.6 15 10 15c-.8 0-1.6-.1-2.3-.3L4 16l.9-2.6c-.9-1-1.4-2.3-1.4-3.9Z" /></svg>
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
  // 点下去立刻高亮目标 Tab，不等服务器回页面；路由真正切过去后以 pathname 为准
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)
  const [seenPathname, setSeenPathname] = useState(pathname)
  if (seenPathname !== pathname) {
    setSeenPathname(pathname)
    setPendingSlug(null)
  }

  // 页面都是动态渲染，Next 默认不预加载；服务器在纽约，每次点 Tab 都要等一个来回。
  // 底栏在的时候把 5 个页面预先取好（router.prefetch 是完整预取，缓存 5 分钟），
  // 每次切页顺手续一次，已经新鲜的不会重复请求。
  useEffect(() => {
    for (const tab of TABS) {
      router.prefetch(tab.slug === 'cc' ? ccReturnHref(window.sessionStorage) : tab.href)
    }
  }, [router, pathname])

  const active = useCallback((slug: string) => {
    if (pendingSlug) return slug === pendingSlug
    if (slug === 'home') return pathname === '/'
    if (slug === 'memory') return pathname === '/memory' || pathname.startsWith('/bucket')
    return pathname.startsWith(`/${slug}`)
  }, [pathname, pendingSlug])

  const go = (slug: string, href: string) => {
    // 点的就是当前页时 pathname 不会变，不设 pending，免得高亮卡住
    if (!active(slug)) setPendingSlug(slug)
    router.push(href)
  }

  return (
    <nav className="mobile-bottom-tabbar fixed bottom-0 left-0 right-0 z-40 border-t" aria-label="主导航">
      <div className="mx-auto flex max-w-lg px-1">
        {TABS.map(tab => (
          <button
            key={tab.slug}
            type="button"
            aria-label={tab.label}
            aria-current={active(tab.slug) ? 'page' : undefined}
            onClick={() => {
              if (tab.slug === 'cc') {
                // 已经在聊天里：点「聊天」回对话列表（同 iOS 点当前 Tab 回这一栏顶层）。
                // 从别的页面过来：回到离开时的那个对话；离开时在列表就回列表。
                if (pathname.startsWith('/cc')) {
                  window.dispatchEvent(new Event('cc:show-list'))
                  router.push(tab.href)
                  return
                }
                go(tab.slug, ccReturnHref(window.sessionStorage))
                return
              }
              go(tab.slug, tab.href)
            }}
            className="tab-item"
          >
            <span className="tab-pill"><TabIcon slug={tab.slug} /></span>
          </button>
        ))}
      </div>
    </nav>
  )
}
