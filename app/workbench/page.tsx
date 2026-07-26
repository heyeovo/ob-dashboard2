'use client'
import { useState } from 'react'
import EntryGrid, { type Entry } from '../components/EntryGrid'
import CcWorkbenchPanel from './CcWorkbenchPanel'

/**
 * 工作台 + 调参（4.6 建，第 5 步填内容）。
 *
 * 工作台 = 当前会话的「现在是什么状态」，跟对话流（过程）互补：
 *   ① 待批准的操作队列   ② 这次会话改过哪些文件   ③ 回退点   ④ 命令输出
 * 内容全在 CcWorkbenchPanel 里，数据来自 /api/cc-workbench。
 *
 * 调参 = 引擎在干什么。现有的 breath-sim 那五个 tab 不搬代码，这里给入口。
 */

const TUNE_ENTRIES: Entry[] = [
  { key: 'breath', label: '模拟 Breath', desc: 'Pipeline / 即时模拟 / 评分旋钮 / 命中统计 / 检索追溯', href: '/breath-sim' },
  { key: 'inject', label: 'gateway 注入监测', desc: '每条回复上的召回按钮已可用；正文要等 Haven 补一列', todo: true },
]

export default function WorkbenchPage() {
  const [tab, setTab] = useState<'bench' | 'tune'>('bench')

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <span className="text-sm font-semibold">{tab === 'bench' ? '工作台' : '调参'}</span>
        <Switch tab={tab} onPick={setTab} />
      </header>

      <main className="mx-auto max-w-5xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden items-end justify-between md:flex">
          <div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
              {tab === 'bench' ? '工作台' : '调参'}
            </h1>
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {tab === 'bench'
                ? '当前会话的状态：待批准、改过的文件、回退点、命令输出'
                : '看引擎在干什么'}
            </p>
          </div>
          <Switch tab={tab} onPick={setTab} />
        </div>

        {tab === 'bench' ? (
          <CcWorkbenchPanel />
        ) : (
          <EntryGrid entries={TUNE_ENTRIES} />
        )}
      </main>
    </div>
  )
}

function Switch({ tab, onPick }: { tab: 'bench' | 'tune'; onPick: (t: 'bench' | 'tune') => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-tertiary)] p-0.5 text-xs">
      {([['bench', '工作台'], ['tune', '调参']] as const).map(([k, label]) => (
        <button
          key={k}
          onClick={() => onPick(k)}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
            tab === k ? 'bg-white text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
