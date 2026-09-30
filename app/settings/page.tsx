'use client'

import Link from 'next/link'
import { useAppearance } from '@/app/components/AppearanceProvider'
import { APPEARANCE_THEMES } from '@/app/lib/appearanceThemes'

type SettingsEntry = { label: string; description: string; href: string; appearance?: boolean }

const GROUPS: { title: string; entries: SettingsEntry[] }[] = [
  {
    title: '常用',
    entries: [
      { label: '外观', description: '主题、背景、字体与字号', href: '/settings/appearance', appearance: true },
      { label: '通知', description: 'Bark 推送与发送状态', href: '/settings/notifications' },
      { label: '模型与中转站', description: '新对话的默认模型、力度和中转站', href: '/settings/upstream' },
    ],
  },
  {
    title: '记忆与引擎',
    entries: [
      { label: '记忆浮现', description: '注入节奏、上下文预算、召回策略', href: '/settings/recall' },
      { label: '记忆处理', description: '打标、向量、重排序', href: '/settings/memory-processing' },
      { label: '自动化', description: 'Persona、夜梦、关系整理、每日画像', href: '/settings/automation' },
      { label: '记忆用的模型', description: '召回、自动记忆与日回顾用哪个模型', href: '/settings/models' },
      { label: '权重配置', description: 'Prompt 与评分权重', href: '/prompts' },
    ],
  },
  {
    title: '数据',
    entries: [
      { label: '导入', description: '拖拽或粘贴，试跑后入库', href: '/import' },
      { label: '回收站', description: '恢复或彻底删除', href: '/trash' },
    ],
  },
]

export default function SettingsPage() {
  const { appearance } = useAppearance()
  const themeName = APPEARANCE_THEMES.find(theme => theme.id === appearance.theme)?.name ?? APPEARANCE_THEMES[0].name
  const appearanceStatus = `${themeName} · ${appearance.background.kind === 'upload' ? '照片' : '渐变'}`

  return (
    <div className="mobile-page-with-topbar min-h-screen bg-[var(--color-bg)] pb-24 text-[var(--color-text-primary)]">
      <header className="mobile-page-topbar flex items-center px-3 md:hidden">
        <span className="text-xl font-semibold" style={{ fontFamily: 'var(--font-display)' }}>设置</span>
      </header>

      <main className="mx-auto max-w-2xl px-3 pt-5 sm:px-6 sm:pt-10">
        <h1 className="mb-6 hidden text-3xl font-bold tracking-tight text-[var(--color-text-heading)] md:block">设置</h1>

        {GROUPS.map(group => (
          <section key={group.title}>
            <div className="flex items-center justify-between px-1 pb-2 pt-5">
              <h2 className="text-3xs font-semibold uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">{group.title}</h2>
            </div>
            <div className="prompt-group">
              {group.entries.map(entry => (
                <Link key={entry.href} href={entry.href} className="prompt-row flex min-h-13 items-center gap-3 px-4 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-note text-[var(--color-text-primary)]">{entry.label}</span>
                    <span className="block text-2xs text-[var(--color-text-tertiary)]">{entry.description}</span>
                  </span>
                  {entry.appearance && <span className="shrink-0 text-2xs text-[var(--color-text-tertiary)]">{appearanceStatus}</span>}
                  <span aria-hidden="true" className="shrink-0 text-[var(--color-text-disabled)]">›</span>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <form action="/api/auth/logout" method="post" className="mt-8 text-center" onSubmit={event => {
          if (!confirm('退出后这台设备要重新输入口令，确定？')) event.preventDefault()
        }}>
          <button type="submit" className="min-h-13 w-full text-note text-[var(--color-danger)]">退出登录</button>
        </form>
      </main>
    </div>
  )
}
