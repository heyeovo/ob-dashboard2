'use client'
import Link from 'next/link'
import Card from '../components/Card'
import { artifactBaseName } from '@/app/lib/artifactMeta'

// 言之用 yanzhi's files 写 / 改了 artifacts/*.html|svg 后，聊天里出的那张卡。
// 代码不进正文，这里只放名字和入口；点开是全屏查看页。

export default function CcArtifactCard({ name, title, action }: { name: string; title?: string; action: 'write' | 'patch' }) {
  return (
    <Link href={`/artifacts/${encodeURIComponent(name)}`} className="mt-1.5 block max-w-sm">
      <Card variant="interactive" padding="sm" className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-base text-[var(--color-primary)]"
          aria-hidden="true"
        >
          ✦
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[var(--color-text-heading)]">
            {title || artifactBaseName(name)}
          </span>
          <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
            {action === 'patch' ? '改好了' : '做好了'} · 点开玩
          </span>
        </span>
        <span className="text-[var(--color-text-tertiary)]" aria-hidden="true">›</span>
      </Card>
    </Link>
  )
}
