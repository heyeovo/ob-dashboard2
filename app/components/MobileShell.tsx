'use client'
import { Suspense } from 'react'
import BottomTabBar from './BottomTabBar'
import type { ReactNode } from 'react'

export default function MobileShell({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div className="md:hidden">
        <Suspense fallback={null}>
          <BottomTabBar />
        </Suspense>
      </div>
    </>
  )
}
