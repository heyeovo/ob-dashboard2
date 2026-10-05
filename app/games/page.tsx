'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Card from '@/app/components/Card'
import SubpageBackButton from '@/app/components/SubpageBackButton'
import { phaseLabel, type Phase } from '@/app/lib/trpg/table'

type Game = { id: string; title: string; phase: Phase }

// 游戏室：家里的其他房间之一。跑团是第一张桌子，剧情模式（OB Todo 6361bb1c）做好后放第二张。
export default function GamesPage() {
  const [games, setGames] = useState<Game[] | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/trpg/games', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : [])
      .then(data => { if (live) setGames(Array.isArray(data) ? data : []) })
      .catch(() => { if (live) setGames([]) })
    return () => { live = false }
  }, [])

  const current = games?.[0]
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 pb-24 pt-5 text-[var(--color-text-primary)] sm:px-6">
    <SubpageBackButton href="/" label="返回主页" />
    <header>
      <p className="mb-1 text-xs tracking-[0.2em] text-[var(--color-text-tertiary)]">GAME ROOM</p>
      <h1 className="text-3xl font-[family-name:var(--font-display)]">游戏室</h1>
    </header>
    <Link href="/trpg" className="block">
      <Card variant="interactive">
        <h2 className="text-lg font-[family-name:var(--font-display)]">跑团</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">调查员、线索与桌边话</p>
        {current && <p className="mt-3 text-xs text-[var(--color-primary)]">进行中 · {current.title} · {phaseLabel[current.phase]}</p>}
      </Card>
    </Link>
    <Card variant="empty">
      <h2 className="text-lg font-[family-name:var(--font-display)] text-[var(--color-text-secondary)]">剧情</h2>
      <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">还在布置</p>
    </Card>
  </main>
}
