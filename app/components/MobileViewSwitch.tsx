'use client'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Mobile-only view switch — timeline / grid toggle.
 * Used inside the memory page header.
 */
export default function MobileViewSwitch() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'timeline'

  return (
    <div className="flex items-center gap-1 bg-[var(--color-surface-tertiary)] rounded-lg p-0.5 text-xs">
      {(['timeline', 'grid'] as const).map(t => (
        <button
          key={t}
          onClick={() => router.replace(`/?tab=${t}`, { scroll: false })}
          className={`px-2.5 py-1 rounded-md transition-colors font-medium ${
            activeTab === t
              ? 'bg-white text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-tertiary)]'
          }`}
        >
          {t === 'timeline' ? '时间线' : '记忆格'}
        </button>
      ))}
    </div>
  )
}
