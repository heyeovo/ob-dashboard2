'use client'

import { useState } from 'react'
import type { parseSentImage } from '@/app/lib/cc/sendImageResult'

export default function CcSentImage({ sessionId, image }: { sessionId: string; image: NonNullable<ReturnType<typeof parseSentImage>> }) {
  const [failedSrc, setFailedSrc] = useState('')
  const src = `/api/cc-attachments/${encodeURIComponent(image.attachmentId)}?session_id=${encodeURIComponent(sessionId)}`
  return <figure className="my-2 max-w-[var(--chat-attachment-width)]">
    <div className="overflow-hidden rounded-xl bg-[var(--color-surface-secondary)]">
      {failedSrc === src ? <div className="flex h-24 min-w-40 items-center justify-center px-3 text-xs text-[var(--color-text-tertiary)]">图片已清除</div> :
        <a href={src} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Haven 私有附件路由 */}
          <img src={src} alt={image.caption || '言之发来的图片'} width={image.width} height={image.height} loading="lazy" className="max-h-64 w-full object-contain" onError={() => setFailedSrc(src)} />
        </a>}
    </div>
    {image.caption ? <figcaption className="mt-1 whitespace-pre-wrap text-xs text-[var(--color-text-tertiary)]">{image.caption}</figcaption> : null}
  </figure>
}
