'use client'
import { useEffect, useState } from 'react'
import BodyPortal from './BodyPortal'
import DetailPanel from './DetailPanel'
import ArtifactPlayer from './ArtifactPlayer'
import type { RoomFile } from '@/app/lib/roomTypes'

export default function RoomFilePreview({ roomId, file, onClose }: { roomId: string; file: RoomFile; onClose: () => void }) {
  const url = `/api/rooms/${encodeURIComponent(roomId)}/files/${file.name.split('/').map(encodeURIComponent).join('/')}`
  const html = /\.html?$/i.test(file.name)
  const image = file.mime.startsWith('image/')
  const [text, setText] = useState('正在读取…')
  useEffect(() => {
    if (html || image) return
    let active = true
    void fetch(url, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('文件读取失败')
      const data = await response.json()
      if (active) setText(data.text == null ? '这个文件暂不支持预览。' : data.text + (data.truncated ? '\n\n（预览已截断）' : ''))
    }).catch(e => { if (active) setText(e.message) })
    return () => { active = false }
  }, [url, html, image])
  if (html) return <BodyPortal><div className="artifact-viewer z-50 flex flex-col float-surface"><header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3"><button className="text-sm room-accent" onClick={onClose}>‹ 返回</button><span className="text-sm truncate flex-1 text-center">{file.name}</span></header><ArtifactPlayer src={`${url}?raw=1`} title={file.name} /></div></BodyPortal>
  return <DetailPanel open onClose={onClose} mode="modal"><div className="p-5"><h2 className="text-lg room-title mb-4 break-all">{file.name}</h2>{image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`${url}?raw=1`} alt={file.name} className="max-w-full" /> : <pre className="text-sm whitespace-pre-wrap break-words">{text}</pre>}</div></DetailPanel>
}
