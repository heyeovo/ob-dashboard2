'use client'
import { useCallback, useRef, useState } from 'react'
import type { XhsNoteData } from './CcXhsCard'
import type { CcAttachment } from './types'

export type XhsCardEntry = {
  status: 'loading' | 'loaded' | 'error'
  note?: XhsNoteData
  error?: string
  loadingText?: string
}

export type XhsLoadResult = {
  note: XhsNoteData
  attachmentIds: string[]
  augmentedText: string
}

const MAX_DESC_CHARS = 500
const MAX_COMMENT_CHARS = 100

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function buildAugmentedText(userText: string, note: XhsNoteData): string {
  const lines = [
    `<xhs_note url="${note.url}">`,
    `标题：${note.title}`,
    `作者：${note.author}`,
    note.desc ? `正文：${truncate(note.desc, MAX_DESC_CHARS)}` : '',
    `互动数据：❤️${note.likedCount} 💬${note.commentCount} ⭐${note.collectedCount}`,
    `配图数量：${note.imageCount}`,
  ].filter(Boolean)

  if (note.comments.length > 0) {
    lines.push('首屏评论：')
    for (const c of note.comments.slice(0, 5)) {
      lines.push(`  ${c.user}${c.ipLocation ? `(${c.ipLocation})` : ''}：${truncate(c.content, MAX_COMMENT_CHARS)}`)
    }
  }
  lines.push('</xhs_note>')

  return `${userText}\n\n${lines.join('\n')}`
}

export function useXhsCard() {
  const [cardsByUrl, setCardsByUrl] = useState<Map<string, XhsCardEntry>>(new Map())
  const [loading, setLoading] = useState(false)

  const loadXhsCard = useCallback(async (
    url: string,
    sessionId: string,
    userText: string,
  ): Promise<XhsLoadResult | null> => {
    setLoading(true)
    setCardsByUrl(prev => {
      const next = new Map(prev)
      next.set(url, { status: 'loading', loadingText: '📕 正在读取笔记…' })
      return next
    })

    try {
      const cardRes = await fetch('/api/xhs-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const cardData = await cardRes.json()
      if (!cardData.ok || !cardData.note) {
        setCardsByUrl(prev => {
          const next = new Map(prev)
          next.set(url, { status: 'error', error: cardData.error || '解析失败' })
          return next
        })
        setLoading(false)
        return null
      }

      const note = cardData.note as XhsNoteData
      setCardsByUrl(prev => {
        const next = new Map(prev)
        next.set(url, { status: 'loading', note, loadingText: `正在加载图片…` })
        return next
      })

      let attachmentIds: string[] = []
      if (note.images.length > 0) {
        const imgRes = await fetch('/api/xhs-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: note.images, session_id: sessionId }),
        })
        const imgData = await imgRes.json()
        if (imgData.ok && Array.isArray(imgData.images)) {
          attachmentIds = imgData.images
            .map((img: { attachmentId?: string }) => img.attachmentId)
            .filter((id: string | undefined): id is string => Boolean(id))
        }
      }

      setCardsByUrl(prev => {
        const next = new Map(prev)
        next.set(url, { status: 'loaded', note })
        return next
      })
      setLoading(false)

      return {
        note,
        attachmentIds,
        augmentedText: buildAugmentedText(userText, note),
      }
    } catch (error) {
      setCardsByUrl(prev => {
        const next = new Map(prev)
        next.set(url, { status: 'error', error: error instanceof Error ? error.message : '加载失败' })
        return next
      })
      setLoading(false)
      return null
    }
  }, [])

  return { cardsByUrl, loading, loadXhsCard }
}
