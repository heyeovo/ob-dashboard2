'use client'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * 记忆库页内切换器（4.6 导航重构）：时间线 / 记忆格。
 *
 * 4.6 之前这两格长在桌面端顶部横条 NavBar 上，横条撤掉后搬进页面里。
 * 手机端也换成这个；原来的 MobileViewSwitch 已删除。
 * MobileViewSwitch.tsx / NavBar.tsx 已于 2026-09-27 删除，需要回退从 git 历史取。
 *
 */

const ITEMS = [
  ['timeline', '时间线'],
  ['grid', '记忆格'],
] as const

export default function MemoryViewSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams?.get('tab') === 'grid' ? 'grid' : 'timeline'

  return (
    <div className={`memory-switch flex items-center gap-1 p-0.5 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
      {ITEMS.map(([slug, label]) => (
        <button
          key={slug}
          onClick={() => router.replace(`/memory?tab=${slug}`, { scroll: false })}
          aria-current={activeTab === slug ? 'page' : undefined}
          className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
            activeTab === slug
              ? 'text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
