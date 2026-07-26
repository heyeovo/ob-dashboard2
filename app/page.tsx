'use client'

import EntryGrid, { type Entry } from './components/EntryGrid'

/**
 * Home（4.6 导航重构）。
 *
 * 新架构里聊天是中心、记忆库是底座，Home 是门面：记忆向的入口 + 以后的美化内容
 * （纪念日之类）。第一版**只做入口卡片，不做内容展示**（用户定的）。
 *
 * 原来挂在这里的 Polaris iframe 搬到了 /polaris，入口在下面「其它」那一组。
 */

const MEMORY_ENTRIES: Entry[] = [
  { key: 'journal', label: '日记', desc: '按时间轴回看每天写下的东西', href: '/journal' },
  { key: 'memory', label: '记忆库', desc: '时间线 / 记忆格 / 待处理', href: '/memory' },
  { key: 'persona', label: 'Persona', desc: '人格状态与近期倾向', todo: true },
  { key: 'care', label: '照顾备忘', desc: '搬 Haven dashboard 那一块', todo: true },
  { key: 'anniversary', label: '纪念日', desc: '以后做美化时一起', todo: true },
]

const TOOL_ENTRIES: Entry[] = [
  { key: 'chat', label: '聊天', desc: '跟协作者聊 · 能一起看代码', href: '/cc' },
  { key: 'workbench', label: '工作台 · 调参', desc: '待批准操作、改过的文件、引擎监测', href: '/workbench' },
  { key: 'graph', label: '关系图谱', desc: '记忆之间的连线', href: '/graph' },
]

const OTHER_ENTRIES: Entry[] = [
  { key: 'polaris', label: 'Polaris', desc: '旧聊天前端，暂时并存', href: '/polaris' },
  { key: 'settings', label: '设置', desc: '导入 / 回收站 / 各项配置', href: '/settings' },
  { key: 'mcp', label: '工具 · MCP', desc: '工具清单与 MCP 服务', todo: true },
  { key: 'usage', label: '用量统计', desc: '订阅额度与花费', todo: true },
  { key: 'provider', label: 'API Provider', desc: '中转站与 key（第 7 步）', todo: true },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      {/* 手机端 mini header，跟记忆库那页一个样式 */}
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <div className="h-4 w-4 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#E8A58F]" />
        <span className="text-sm font-semibold">小言&小羊的家</span>
      </header>

      <main className="mx-auto max-w-5xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
            小言&小羊的家
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            聊天是中心，记忆是底座。这一页先只放入口。
          </p>
        </div>

        <EntryGrid title="记忆" entries={MEMORY_ENTRIES} />
        <EntryGrid title="干活" entries={TOOL_ENTRIES} />
        <EntryGrid title="其它" entries={OTHER_ENTRIES} />
      </main>
    </div>
  )
}
