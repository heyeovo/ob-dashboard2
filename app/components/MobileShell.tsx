'use client'
import { Suspense } from 'react'
import BottomTabBar from './BottomTabBar'
import type { ReactNode } from 'react'

/**
 * Mobile layout wrapper — adds BottomTabBar and bottom padding.
 * Desktop unchanged.
 */
export default function MobileShell({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* Bottom tab bar — only visible on small screens */}
      <div className="md:hidden">
        <Suspense fallback={null}>
          <BottomTabBar />
        </Suspense>
      </div>
      {/* Extra bottom padding on mobile for the tab bar + safe area */}
      <div className="md:hidden h-20" />
    </>
  )
}
