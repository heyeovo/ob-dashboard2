'use client'

export type XhsNoteData = {
  title: string
  author: string
  desc: string
  images: string[]
  imageCount: number
  likedCount: string
  commentCount: string
  collectedCount: string
  comments: Array<{ user: string; content: string; ipLocation: string }>
  url: string
}

const XHS_LINK_RE = /https?:\/\/(?:www\.)?(?:xiaohongshu\.com\/(?:explore|discovery\/item)\/[a-f0-9]+|xhslink\.(?:cn|com)\/[^\s]+)/i

export function extractXhsUrl(text: string): string | null {
  const match = text.match(XHS_LINK_RE)
  return match ? match[0] : null
}

type CardState = {
  status: 'loading' | 'loaded' | 'error'
  note?: XhsNoteData
  error?: string
  loadingText?: string
}

function SkeletonCard({ text }: { text: string }) {
  return (
    <div className="xhs-card xhs-card-skeleton">
      <div className="xhs-card-cover-skeleton animate-pulse" />
      <div className="xhs-card-body">
        <div className="h-4 w-3/4 rounded bg-[var(--color-surface-tertiary)] animate-pulse" />
        <div className="mt-2 h-3 w-full rounded bg-[var(--color-surface-tertiary)] animate-pulse" />
        <div className="mt-1.5 h-3 w-2/3 rounded bg-[var(--color-surface-tertiary)] animate-pulse" />
        <div className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">{text}</div>
      </div>
    </div>
  )
}

export default function CcXhsCard({ state }: { state: CardState }) {
  if (state.status === 'loading') {
    return <SkeletonCard text={state.loadingText || '📕 正在读取笔记…'} />
  }

  if (state.status === 'error') {
    return (
      <div className="xhs-card xhs-card-error">
        <div className="px-4 py-3 text-[12px] text-[var(--color-text-tertiary)]">
          小红书笔记加载失败：{state.error || '未知错误'}
        </div>
      </div>
    )
  }

  const note = state.note
  if (!note) return null

  const coverUrl = note.images[0]

  return (
    <a
      href={note.url}
      target="_blank"
      rel="noreferrer"
      className="xhs-card xhs-card-loaded group"
    >
      {coverUrl ? (
        <div className="xhs-card-cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt={note.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {note.imageCount > 1 ? (
            <span className="xhs-card-badge">{note.imageCount} 图</span>
          ) : null}
        </div>
      ) : null}
      <div className="xhs-card-body">
        <div className="xhs-card-title">{note.title || '无标题'}</div>
        {note.desc ? (
          <div className="xhs-card-desc">{note.desc}</div>
        ) : null}
        <div className="xhs-card-meta">
          <span className="xhs-card-author">{note.author}</span>
          <span className="xhs-card-stats">
            ❤️ {note.likedCount} · 💬 {note.commentCount} · ⭐ {note.collectedCount}
          </span>
        </div>
      </div>
    </a>
  )
}
