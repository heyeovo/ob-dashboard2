import SubpageBackButton from '@/app/components/SubpageBackButton'
import Link from 'next/link'
import McpManager from '@/app/components/McpManager'

export default function McpPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 text-[var(--color-text-primary)]">
      <header className="md:sticky md:top-0 md:z-20 md:border-b md:border-[var(--color-border)] md:bg-[var(--color-bg)]/85 md:backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-4 px-3 pb-4 pt-5 md:h-14 md:flex-row md:items-center md:gap-3 md:py-0 sm:px-6">
          <SubpageBackButton href="/workbench" label="返回工作台" className="md:hidden" />
          <Link href="/" className="hidden h-8 w-8 items-center justify-center rounded-lg text-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-overlay)]/5 md:flex" aria-label="返回主页">←</Link>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-heading)] md:text-sm">工具 · MCP</h1>
            <p className="text-xs text-[var(--color-text-tertiary)] md:text-2xs">连接服务并决定哪些工具交给协作者</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
        <McpManager />
      </main>
    </div>
  )
}
