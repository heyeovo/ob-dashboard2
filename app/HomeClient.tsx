'use client'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
// 把原来 page.tsx 中除了顶部类型定义和工具函数之外的所有代码复制到这里
// 包括: 所有类型, 工具函数, QUICK_FILTERS, DATE_PRESETS, isFeel, matchesQuickFilter 等
// 以及原来的 Home 组件全部内容（export default function Home() { ... }）
// 但记得把组件名改为 HomeClient 并导出
export default function HomeClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeTab = (searchParams.get('tab') as 'timeline' | 'grid' | 'review') || 'timeline'

  // ... 其余所有状态、函数、JSX 保持不变，直接复制过来
}