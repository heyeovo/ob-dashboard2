import type { ReactNode } from 'react'
import type { PortraitEvidence, PortraitRow, PortraitScope } from './portraitTypes'

/** 画像模块共享的小展示件：chip / 时间格式化 / 行元数据 / 证据行 / 空态 */

export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)]"
    >
      {children}
    </span>
  )
}

export function portraitScopeLabel(scope: PortraitScope): string {
  return {
    user: 'User Portrait',
    persona: '自我总入口 · 现在的我',
    relationship: 'Relationship Portrait',
  }[scope]
}

export function formatTs(value?: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function formatDate(value?: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed)
}

export function rowText(item: PortraitRow): string {
  return item.text || item.summary || item.fact || item.reason || ''
}

export function rowDateLabel(item: PortraitRow): string {
  if (item.time_label) return `time ${item.time_label}`
  const dates: string[] = []
  if (Array.isArray(item.source_dates)) {
    item.source_dates.forEach(date => {
      const text = String(date || '').trim()
      if (text && !dates.includes(text)) dates.push(text)
    })
  }
  if (item.source_date) dates.unshift(String(item.source_date))
  if (dates.length) return `source ${dates.slice(0, 3).join(', ')}`
  if (item.last_seen_date) return `seen ${item.last_seen_date}`
  return item.updated_at || item.created_at || ''
}

export function rowMetaChips(item: PortraitRow): string[] {
  const meta: string[] = []
  if (item.scope) meta.push(String(item.scope))
  if (item.status) meta.push(String(item.status))
  if (item.profile_kind) meta.push(String(item.profile_kind))
  if (item.predicate) meta.push(String(item.predicate))
  if (item.object) meta.push(String(item.object))
  if (item.confidence != null) meta.push(`confidence ${Number(item.confidence).toFixed(2)}`)
  if (item.count != null) meta.push(`seen ${item.count}`)
  const date = rowDateLabel(item)
  if (date) meta.push(date)
  return meta
}

export function EvidenceLine({ evidence }: { evidence?: PortraitEvidence[] }) {
  const rows = (evidence || []).filter(
    item => item && (item.bucket_id || item.moment_id || item.session_id),
  )
  if (!rows.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-disabled)]">
      {rows.slice(0, 4).map((item, index) => {
        const bucketId = item.bucket_id || ''
        const labels = [
          bucketId ? `#${bucketId}` : '',
          item.moment_id || '',
          item.session_id ? `session ${item.session_id}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <span key={index}>
            evidence: {labels}
            {bucketId && (
              <a className="ml-1 text-[var(--color-primary)]" href={`/bucket/${bucketId}`}>
                打开证据
              </a>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <div className="py-2 text-xs text-[var(--color-text-disabled)]">{children}</div>
}

/** 主按钮（小尺寸，危险态 variant 用 danger） */
export function ActionButton({
  children,
  onClick,
  variant = 'default',
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}) {
  const tone =
    variant === 'danger'
      ? 'border-rose-200 bg-white text-[var(--color-danger)] hover:bg-rose-50'
      : 'border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  )
}
