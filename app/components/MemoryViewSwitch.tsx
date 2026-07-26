'use client'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * 记忆库页内切换器（4.6 导航重构）：时间线 / 记忆格 / 待处理。
 *
 * 4.6 之前这三格长在桌面端顶部横条 NavBar 上，横条撤掉后搬进页面里。
 * 手机端也换成这个（原来的 MobileViewSwitch 只有两格，没有「待处理」；
 * 底部 Tab 里那个「审阅」格 4.6 之后没了，入口必须收进切换器）。
 * MobileViewSwitch.tsx / NavBar.tsx 都留在仓库里没删，方便回退。
 *
 * 「待处理」= 原来的「审阅」。改名理由：审阅 + 自动记忆候选对用户是同一个动作
 * （有东西等我拍板）。这一版内容和逻辑不动，只改名 + 挪位置。
 */

const ITEMS = [
  ['timeline', '时间线'],
  ['grid', '记忆格'],
  ['review', '待处理'],
] as const

export default function MemoryViewSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams?.get('tab') || 'timeline'

  return (
    <div className={`flex items-center gap-1 rounded-lg bg-[var(--color-surface-tertiary)] p-0.5 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
      {ITEMS.map(([slug, label]) => (
        <button
          key={slug}
          onClick={() => router.replace(`/memory?tab=${slug}`, { scroll: false })}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === slug
              ? 'bg-white text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
