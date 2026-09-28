'use client'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '../components/Card'
import type { ArtifactMeta } from '@/app/lib/artifacts'

// 言之做过的小东西：yanzhi's files/artifacts 下的页面，按最近修改排。

function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function ArtifactsPage() {
  const [items, setItems] = useState<ArtifactMeta[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/artifacts', { cache: 'no-store' })
      .then(response => response.json())
      .then((data: { ok?: boolean; items?: ArtifactMeta[]; error?: string }) => {
        if (!alive) return
        if (data.ok) setItems(data.items || [])
        else setError(data.error || '读取失败')
      })
      .catch(() => { if (alive) setError('读取失败') })
    return () => { alive = false }
  }, [])

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <main className="mx-auto max-w-5xl px-3 pt-5 sm:px-6 sm:pt-10">
        <SubpageBackButton href="/workbench" label="返回工作台" className="mb-5 md:hidden" />
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-[var(--color-text-heading)] md:text-3xl">小作品</h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">言之做过的页面、小游戏和图，点开就能玩</p>
        </div>

        {error ? (
          <Card variant="empty" className="text-sm text-[var(--color-danger)]">{error}</Card>
        ) : items === null ? (
          <div className="text-sm text-[var(--color-text-tertiary)]">加载中…</div>
        ) : items.length === 0 ? (
          <Card variant="empty" padding="lg" className="text-center text-sm text-[var(--color-text-tertiary)]">
            还没有作品。聊天里让言之做一个，就会出现在这里。
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(item => (
              <Link key={item.name} href={`/artifacts/${encodeURIComponent(item.name)}`} className="block">
                <Card variant="interactive" padding="md" className="h-full">
                  <div className="flex items-start gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] text-base text-[var(--color-primary)]"
                      aria-hidden="true"
                    >
                      {item.kind === 'svg' ? '◐' : '✦'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--color-text-heading)]">{item.title}</div>
                      {item.description ? (
                        <div className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-secondary)]">{item.description}</div>
                      ) : null}
                      <div className="mt-1.5 text-meta text-[var(--color-text-tertiary)]">
                        {shortDate(item.updated_at)} · {item.name}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
