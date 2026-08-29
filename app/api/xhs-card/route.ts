import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const XHS_URL_PATTERNS = [
  /xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]+)/i,
  /xhslink\.cn\//i,
  /xhslink\.com\//i,
]

function isXhsUrl(url: string): boolean {
  return XHS_URL_PATTERNS.some(pattern => pattern.test(url))
}

function fixImageUrl(raw: string): string {
  let url = raw.replace(/\\u002F/g, '/')
  if (url.startsWith('//')) url = `https:${url}`
  return url
}

type NoteData = {
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

function extractNoteData(html: string, finalUrl: string): NoteData | null {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?})\s*<\/script>/)
    || html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});\s*<\/script>/)
  if (!match) return null

  let raw = match[1].replace(/undefined/g, 'null')
  let state: Record<string, unknown>
  try {
    state = JSON.parse(raw)
  } catch {
    raw = raw.replace(/\\u002F/g, '/')
    try {
      state = JSON.parse(raw)
    } catch {
      return null
    }
  }

  // 两种页面结构：
  // 1. state.noteData.data.noteData (手机版 discovery/item)
  // 2. state.note.noteDetailMap[id].note (旧版 explore)
  let note: Record<string, unknown> | undefined
  let commentSource: Record<string, unknown> | undefined

  const noteDataRoot = state.noteData as Record<string, unknown> | undefined
  if (noteDataRoot) {
    const data = noteDataRoot.data as Record<string, unknown> | undefined
    note = data?.noteData as Record<string, unknown> | undefined
    commentSource = data?.commentData as Record<string, unknown> | undefined
  }

  if (!note) {
    const noteState = state.note as Record<string, unknown> | undefined
    if (noteState) {
      const noteDetailMap = noteState.noteDetailMap as Record<string, unknown> | undefined
      if (noteDetailMap) {
        const firstKey = Object.keys(noteDetailMap)[0]
        if (firstKey) {
          const entry = noteDetailMap[firstKey] as Record<string, unknown> | undefined
          note = entry?.note as Record<string, unknown> | undefined
        }
      }
    }
  }

  if (!note) return null

  const title = String(note.title || '')
  const desc = String(note.desc || '')
  const user = note.user as Record<string, unknown> | undefined
  const author = String(user?.nickName || user?.nickname || user?.nick_name || '')

  const imageList = (note.imageList || note.images || []) as Array<Record<string, unknown>>
  const images = imageList
    .map(img => {
      const urlDefault = img.urlDefault || img.url || img.url_default || ''
      return fixImageUrl(String(urlDefault))
    })
    .filter(url => url.startsWith('http'))

  const interactInfo = note.interactInfo as Record<string, unknown> | undefined
  const likedCount = String(interactInfo?.likedCount || interactInfo?.liked_count || '0')
  const commentCount = String(interactInfo?.commentCount || interactInfo?.comment_count || '0')
  const collectedCount = String(interactInfo?.collectedCount || interactInfo?.collected_count || '0')

  let comments: Array<{ user: string; content: string; ipLocation: string }> = []
  if (commentSource) {
    const commentList = (commentSource.comments || []) as Array<Record<string, unknown>>
    comments = commentList.slice(0, 10).map(c => {
      const cUser = c.user as Record<string, unknown> | undefined
      return {
        user: String(cUser?.nickname || cUser?.nickName || ''),
        content: String(c.content || ''),
        ipLocation: String(c.ipLocation || c.ip_location || ''),
      }
    })
  }

  return {
    title,
    author,
    desc,
    images,
    imageCount: images.length,
    likedCount,
    commentCount,
    collectedCount,
    comments,
    url: finalUrl,
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 })
  }

  const url = String(body.url || '').trim()
  if (!url || !isXhsUrl(url)) {
    return Response.json({ ok: false, error: '不是有效的小红书链接' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': MOBILE_UA },
      redirect: 'follow',
    })
    if (!response.ok) {
      return Response.json({ ok: false, error: `请求小红书页面失败: ${response.status}` }, { status: 502 })
    }
    const html = await response.text()
    const finalUrl = response.url || url

    const note = extractNoteData(html, finalUrl)
    if (!note) {
      return Response.json({ ok: false, error: '解析笔记数据失败，页面结构可能已变' }, { status: 502 })
    }

    return Response.json({ ok: true, note })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : '抓取小红书页面失败',
    }, { status: 502 })
  }
}
