'use client'
import Link from 'next/link'

/**
 * 入口卡片网格（4.6 导航重构）。Home 和 设置 两页共用。
 *
 * 第一版只做入口，不展示内容。没接口的格子给 todo=true，
 * 渲染成不可点的虚线卡 + 「待做」角标。
 */

export type Entry = {
  key: string
  label: string
  desc?: string
  href?: string
  todo?: boolean
}

export function EntryCard({ entry }: { entry: Entry }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm font-semibold ${entry.todo ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-heading)]'}`}>
          {entry.label}
        </span>
        {entry.todo ? (
          <span className="shrink-0 rounded-full bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
            待做
          </span>
        ) : (
          <span className="shrink-0 text-[var(--color-text-disabled)]">→</span>
        )}
      </div>
      {entry.desc && (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-tertiary)]">{entry.desc}</p>
      )}
    </>
  )

  if (entry.todo || !entry.href) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/50 px-4 py-3.5">
        {inner}
      </div>
    )
  }

  return (
    <Link
      href={entry.href}
      className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3.5 transition-all duration-200 hover:border-[var(--color-primary)]/30 hover:shadow-md"
    >
      {inner}
    </Link>
  )
}

export default function EntryGrid({ title, entries }: { title?: string; entries: Entry[] }) {
  return (
    <section className="mb-7">
      {title && (
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {title}
        </h2>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
        {entries.map(e => (
          <EntryCard key={e.key} entry={e} />
        ))}
      </div>
    </section>
  )
}
