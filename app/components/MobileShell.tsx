'use client'
import { Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import BottomTabBar from './BottomTabBar'
import SideRail from './SideRail'
import type { ReactNode } from 'react'

/**
 * 全站外壳。
 * 桌面端 = 左侧竖排 SideRail（fixed，所以内容整体右移一栏宽）。
 * 手机端 = 底部 5 Tab。
 *
 * 4.6 之前桌面导航是每个页面各自 <NavBar />，现在统一收在这里。
 */
export default function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  // 点链接进新页面时回到顶部。Next 自己的滚动判断是「新页面顶边还在视口里就不滚」，
  // 从滚过一截的工作台点进子页面时会停在半截、标题压在状态栏下。浏览器前进 / 后退不动，留给原生恢复。
  const popped = useRef(false)
  useEffect(() => {
    const onPop = () => { popped.current = true }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useLayoutEffect(() => {
    if (popped.current) { popped.current = false; return }
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <>
      <Suspense fallback={null}>
        <SideRail />
      </Suspense>
      {/* 不要给这层加 z-index：会把页面里的弹窗 / 抽屉关进同一层级，压到底部 Tab 下面。
          背景、雨痕、颗粒用负 z-index 沉到内容下方（见 globals.css「层级」）。 */}
      {/* key 按路径：换页时重挂这一层，播一次 .page-enter 淡入 */}
      <div key={pathname} className="page-enter relative md:pl-[68px]">{children}</div>
      <div className="md:hidden">
        <Suspense fallback={null}>
          <BottomTabBar />
        </Suspense>
      </div>
    </>
  )
}
