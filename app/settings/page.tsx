'use client'

import EntryGrid, { type Entry } from '../components/EntryGrid'

/**
 * 设置 Tab（4.6 导航重构，右二格）。
 *
 * 第一版只做入口聚合：已有的页面给链接，Haven dashboard.html 里那批还没搬过来的
 * 标「待做」。跟 Home 共用 EntryGrid。
 */

const DATA_ENTRIES: Entry[] = [
  { key: 'import', label: '导入', desc: '拖拽 / 粘贴，试跑后入库', href: '/import' },
  { key: 'trash', label: '回收站', desc: '恢复 / 彻底删除 / 清空', href: '/trash' },
  { key: 'graph', label: '关系图谱', desc: '暂时收在这里', href: '/graph' },
]

const ENGINE_ENTRIES: Entry[] = [
  { key: 'prompts', label: '权重配置', desc: 'Prompt 与评分权重', href: '/prompts' },
  { key: 'breath', label: '模拟 Breath', desc: '四维评分与检索追溯', href: '/breath-sim' },
  {
    key: 'recall',
    label: '记忆浮现配置',
    desc: '注入节奏 / 上下文预算 / 召回策略 / 图扩散',
    href: '/settings/recall',
  },
  {
    key: 'pipeline',
    label: '记忆处理',
    desc: '脱水打标 / 向量 / 重排序',
    href: '/settings/memory-processing',
  },
  { key: 'persona-state', label: 'Persona State', desc: '内在状态 + 画像查看', href: '/persona?tab=state' },
  {
    key: 'automation',
    label: '自动化与状态',
    desc: 'Persona / 夜梦 / 关系整理 / 每日画像 / 自我入口 / 合并阈值',
    href: '/settings/automation',
  },
]

const MODEL_ENTRIES: Entry[] = [
  {
    key: 'upstream',
    label: '上游模型配置',
    desc: '中转站清单 + 模型名；新对话的默认模型 / 力度',
    href: '/settings/upstream',
  },
  {
    key: 'memory-models',
    label: '召回、自动记忆与日回顾模型',
    desc: '主域哨兵 / 召回模型；已暂停的自动记忆；日回顾模型',
    href: '/settings/models',
  },
  { key: 'ui', label: 'UI 设置', desc: '主题 / 字体 / 字号，等新风格铺开后做', todo: true },
]

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <span className="text-sm font-semibold">设置</span>
      </header>

      <main className="mx-auto max-w-5xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">设置</h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            数据、引擎、模型三组。标「待做」的是 Haven dashboard 里还没搬过来的部分。
          </p>
        </div>

        <EntryGrid title="数据" entries={DATA_ENTRIES} />
        <EntryGrid title="引擎与记忆" entries={ENGINE_ENTRIES} />
        <EntryGrid title="模型与外观" entries={MODEL_ENTRIES} />

        <section className="mt-8 border-t border-[var(--color-border)] pt-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">登录状态</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">退出后，这台设备需要重新输入 Dashboard 口令。</p>
          <form action="/api/auth/logout" method="post" className="mt-3">
            <button
              type="submit"
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-secondary)]"
            >
              退出登录
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
