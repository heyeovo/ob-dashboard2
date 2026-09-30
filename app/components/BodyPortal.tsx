'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const subscribe = () => () => {}

/**
 * 把全屏浮层（抽屉、底部弹窗、模态框）挂到 body 下。
 * 浮层留在页面树里时，只要某一层祖先带了 transform / opacity 动画 / backdrop-filter，
 * fixed 的浮层就会被关进那一层，压到底部 Tab 下面。挂到 body 就不受祖先影响。
 */
export default function BodyPortal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  return mounted ? createPortal(children, document.body) : null
}
