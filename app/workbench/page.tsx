'use client'
import { useState } from 'react'
import EntryGrid, { type Entry } from '../components/EntryGrid'

/**
 * 工作台 + 调参（4.6 导航重构，右一格）。
 *
 * 工作台 = 当前会话的「现在是什么状态」，跟对话流（过程）互补：
 *   ① 待批准的操作队列   ② 这次会话改过哪些文件   ③ 回退点   ④ 命令输出
 * 四条都要等第 5 步（canUseTool + diff 批准 / 写权限）才有数据，这一版是空态占位。
 *
 * 调参 = 引擎在干什么。现有的 breath-sim 那五个 tab 不搬代码，这里给入口。
 */

const TUNE_ENTRIES: Entry[] = [
  { key: 'breath', label: '模拟 Breath', desc: 'Pipeline / 即时模拟 / 评分旋钮 / 命中统计 / 检索追溯', href: '/breath-sim' },
  { key: 'inject', label: 'gateway 注入监测', desc: '每条回复上的召回按钮已可用；正文要等 Haven 补一列', todo: true },
]

const SLOTS = [
  { key: 'queue', label: '待批准的操作', hint: '模型要改文件 / 跑命令时，请求排在这里等你点批准。手机上也找得回来。' },
  { key: 'files', label: '这次会话改过的文件', hint: '累计 diff，不是散在十条消息里的增量。' },
  { key: 'rewind', label: '回退点', hint: '「这个方案不要了」可以真撤销，回到某条消息时的文件状态。' },
  { key: 'output', label: '命令输出', hint: 'build 报错那种长输出放这里，不在气泡里刷屏。' },
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
          <>
            <div className="mb-5 rounded-xl border border-dashed border-[var(--color-border)] bg-white/50 px-4 py-3 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              这四格都是<b className="font-semibold">当前会话</b>的状态，切会话就换一套。
              现在聊天页是只读权限（只能看代码、不能改文件不能跑命令），所以还没有数据 ——
              等第 5 步接上写权限和 diff 批准。
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
              {SLOTS.map(s => (
                <div key={s.key} className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/50 px-4 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-tertiary)]">{s.label}</span>
                    <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                      第 5 步
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-tertiary)]">{s.hint}</p>
                </div>
              ))}
            </div>
          </>
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
