import Link from 'next/link'
import McpManager from '@/app/components/McpManager'

export default function McpPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-20 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-3 sm:px-6">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-[var(--color-text-secondary)] hover:bg-black/5"
            aria-label="返回主页"
          >
            ←
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-[var(--color-text-heading)]">工具 · MCP</h1>
            <p className="text-[10px] text-[var(--color-text-tertiary)]">连接服务并决定哪些工具交给协作者</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
        <McpManager />
      </main>
    </div>
  )
}
