'use client'
import { Suspense } from 'react'
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
  return (
    <>
      <Suspense fallback={null}>
        <SideRail />
      </Suspense>
      <div className="md:pl-[68px]">{children}</div>
      <div className="md:hidden">
        <Suspense fallback={null}>
          <BottomTabBar />
        </Suspense>
      </div>
    </>
  )
}
