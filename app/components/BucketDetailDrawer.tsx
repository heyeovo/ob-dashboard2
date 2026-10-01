'use client'
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import DetailPanel from './DetailPanel'

// List and detail endpoints place source/wish in different locations.
interface BucketComment {
  id?: string
  created?: string
  author?: string
  kind?: string
  content?: string
}

interface BucketDetail {
  id: string
  content: string
  score: number
  source?: string        // 列表接口在顶层，单桶在 metadata.source
  noise?: boolean
  wish?: boolean         // 列表接口在顶层，单桶在 metadata.wish
  type?: string
  valence?: number
  arousal?: number
  metadata: {
    name: string
    domain: string[]
    tags: string[]
    valence: number
    arousal: number
    importance: number
    pinned: boolean
    resolved: boolean
    digested?: boolean
    type: string
    created: string
    last_active: string
    activation_count?: number
    related?: string[]
    event_time?: string
    source?: string       // 单桶接口在此
    wish?: boolean
    comments?: BucketComment[]
  }
}

interface Props {
  selected: BucketDetail | null
  detailLoading: boolean
  editing: boolean
  editContent: string
  saving: boolean
  operating: boolean
  copied: boolean
  onClose: () => void
  onStartEdit: (content: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onTraceOp: (id: string, args: Record<string, unknown>) => Promise<void>
  onCopyId: () => void
  onImportanceChange?: (id: string, val: number) => void  // 可选，用于 importance 修改
  onTouch: (id: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onActivate: (id: string) => Promise<void>
}


interface SimilarBucket { id: string; name?: string; similarity?: number }
type IconName = 'copy' | 'edit' | 'delete' | 'close' | 'chevron' | 'pin' | 'digest' | 'resolve' | 'archive' | 'wish' | 'noise' | 'touch' | 'activate'
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    copy: <><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15V5a2 2 0 012-2h10" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></>,
    delete: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    chevron: <path d="M9 6l6 6-6 6" />,
    pin: <path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />,
    digest: <><path d="M4 9h13v5a6 6 0 01-6 6h-1a6 6 0 01-6-6zM17 10h1.5a2.5 2.5 0 010 5H17M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3" /></>,
    resolve: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 10" /></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9M10 13h4" /></>,
    wish: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
    noise: <path d="M3 12h2l2-5 3 10 3-12 3 9 2-2h3" />,
    touch: <><circle cx="12" cy="12" r="2.5" /><circle cx="12" cy="12" r="6" opacity=".55" /><circle cx="12" cy="12" r="9.5" opacity=".25" /></>,
    activate: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

// Intl uses an explicit zone: the browser and deployment host may be outside Beijing.
function beijingTime(value: string, event = false) {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未设置'
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: event ? 'numeric' : '2-digit', day: event ? 'numeric' : '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(event ? { weekday: 'short' as const } : {}),
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || ''
  return event
    ? part('month') + '月' + part('day') + '日 ' + part('weekday').replace('星期', '周') + ' ' + part('hour') + ':' + part('minute')
    : part('month') + '/' + part('day') + ' ' + part('hour') + ':' + part('minute')
}

export default function BucketDetailDrawer(props: Props) {
  return (
    <DetailPanel open={!!(props.selected || props.detailLoading)} onClose={props.onClose} mode="drawer" loading={props.detailLoading} className="bucket-drawer-scroll">
      {props.selected && <BucketContent key={props.selected.id} {...props} selected={props.selected} />}
    </DetailPanel>
  )
}

function BucketContent({ selected, editing, editContent, saving, operating, copied, onClose, onStartEdit, onCancelEdit, onSaveEdit, onTraceOp, onCopyId, onImportanceChange, onTouch, onArchive, onActivate }: Omit<Props, 'selected'> & { selected: BucketDetail }) {
  const [editingImp, setEditingImp] = useState(false)
  const [localImp, setLocalImp] = useState('')
  const [editingEventTime, setEditingEventTime] = useState(false)
  const [eventTimeVal, setEventTimeVal] = useState('')
  const [contentCopied, setContentCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [idCopied, setIdCopied] = useState(false)
  const [similarOpen, setSimilarOpen] = useState(false)
  const [similarBuckets, setSimilarBuckets] = useState<SimilarBucket[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)
  const [similarLoaded, setSimilarLoaded] = useState(false)
  const [similarError, setSimilarError] = useState('')
  const [embEnabled, setEmbEnabled] = useState(true)
  const [commentState, setCommentState] = useState<{ bucketId: string; comments: BucketComment[] } | null>(null)
  const [editingCommentId, setEditingCommentId] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [commentOperatingId, setCommentOperatingId] = useState('')
  const [commentError, setCommentError] = useState('')
  const [armedDelete, setArmedDelete] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteDeadline = useRef(0)
  const deleteTarget = useRef('')
  const busy = operating || deleting

  const comments = commentState && commentState.bucketId === selected.id
    ? commentState.comments : selected.metadata.comments || []

  const mutateComment = async (commentId: string, method: 'PATCH' | 'DELETE', content?: string) => {
    if (!selected) return
    setCommentOperatingId(commentId)
    setCommentError('')
    try {
      const response = await fetch(
        `/api/bucket/${encodeURIComponent(selected.id)}/comments/${encodeURIComponent(commentId)}`,
        {
          method,
          headers: method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
          body: method === 'PATCH' ? JSON.stringify({ content }) : undefined,
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '年轮操作失败')
      if (method === 'PATCH') {
        setCommentState(current => {
          const source = current?.bucketId === selected.id ? current.comments : selected.metadata.comments || []
          return {
            bucketId: selected.id,
            comments: source.map(comment => (
              comment.id === commentId ? { ...comment, content: data.comment?.content ?? content } : comment
            )),
          }
        })
        setEditingCommentId('')
        setCommentDraft('')
      } else {
        setCommentState(current => {
          const source = current?.bucketId === selected.id ? current.comments : selected.metadata.comments || []
          return { bucketId: selected.id, comments: source.filter(comment => comment.id !== commentId) }
        })
      }
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : String(error))
    } finally {
      setCommentOperatingId('')
    }
  }


  useEffect(() => {
    if (!armedDelete) return
    const timer = setTimeout(() => { setArmedDelete(''); deleteTarget.current = ''; deleteDeadline.current = 0 }, 3000)
    return () => clearTimeout(timer)
  }, [armedDelete])
  useEffect(() => {
    if (!contentCopied) return
    const timer = setTimeout(() => setContentCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [contentCopied])
  useEffect(() => {
    if (!copied) return
    setIdCopied(true)
    const timer = setTimeout(() => setIdCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])

  // Only an expanded section fetches. Abort on close/bucket change to discard stale results.
  useEffect(() => {
    if (!similarOpen || similarLoaded) return
    const controller = new AbortController()
    setSimilarLoading(true)
    setSimilarError('')
    const load = async () => {
      try {
        const response = await fetch('/api/bucket/' + encodeURIComponent(selected.id) + '/similar?n=5', { signal: controller.signal })
        const data = await response.json()
        if (!response.ok || data.error) throw new Error(data.error || '查找失败')
        if (controller.signal.aborted) return
        setSimilarBuckets(Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [])
        setEmbEnabled(data.embedding_enabled !== false)
        setSimilarLoaded(true)
      } catch (error) {
        if (!controller.signal.aborted) setSimilarError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!controller.signal.aborted) setSimilarLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [similarOpen, similarLoaded, selected.id])

  const confirmDelete = (target: string, action: () => void) => {
    if (deleteTarget.current === target && Date.now() < deleteDeadline.current) {
      deleteTarget.current = ''; deleteDeadline.current = 0; setArmedDelete(''); action()
    } else {
      deleteTarget.current = target; deleteDeadline.current = Date.now() + 3000; setArmedDelete(target)
    }
  }
  const erase = async () => {
    setDeleting(true); setDeleteError('')
    try { await onTraceOp(selected.id, { delete: true }); onClose() }
    catch (error) { setDeleteError(error instanceof Error ? error.message : String(error)) }
    finally { setDeleting(false) }
  }
  const saveImportance = () => {
    const value = Number(localImp)
    if (!Number.isInteger(value) || value < 1 || value > 10) return
    setEditingImp(false)
    if (value !== selected.metadata.importance) {
      if (onImportanceChange) onImportanceChange(selected.id, value)
      else void onTraceOp(selected.id, { importance: value })
    }
  }
  const sWish = selected.wish ?? selected.metadata.wish ?? false
  const sSource = selected.metadata.source || selected.source || ''
  const sourceLabel = ({ ai: 'AI 写入', AI: 'AI 写入', manual: '手动写入', user: '手动写入', dashboard: '手动写入', import: '导入', imported: '导入', system: '系统写入' } as Record<string, string>)[sSource] || sSource
  const isNoise = Boolean(selected.noise || (selected.metadata.resolved && selected.metadata.importance === 1))
  const actions: { label: string; status?: string; icon: IconName; active?: boolean; run: () => void }[] = [
    { label: '钉选', status: '已钉选', icon: 'pin', active: selected.metadata.pinned, run: () => { void onTraceOp(selected.id, { pinned: selected.metadata.pinned ? 0 : 1 }) } },
    { label: '消化', status: '已消化', icon: 'digest', active: selected.metadata.digested, run: () => { void onTraceOp(selected.id, { digested: selected.metadata.digested ? 0 : 1 }) } },
    { label: '解决', status: '已解决', icon: 'resolve', active: selected.metadata.resolved, run: () => { void onTraceOp(selected.id, { resolved: selected.metadata.resolved ? 0 : 1 }) } },
    { label: '归档', status: '已归档', icon: 'archive', active: selected.metadata.type === 'archived', run: () => { void onArchive(selected.id) } },
    { label: '悬念', status: '悬念中', icon: 'wish', active: sWish, run: () => { void onTraceOp(selected.id, { wish: sWish ? 0 : 1 }) } },
    { label: '噪声', status: '噪声', icon: 'noise', active: isNoise, run: () => { void onTraceOp(selected.id, isNoise ? { resolved: false } : { resolved: true, importance: 1 }) } },
    { label: '轻触', icon: 'touch', run: () => { void onTouch(selected.id) } },
    { label: '激活', icon: 'activate', run: () => { void onActivate(selected.id) } },
  ]
  const eventTime = selected.metadata.event_time || selected.metadata.created || ''

  return (
    <div className="bucket-drawer">
      <div className="bucket-drawer-inner">
        <div className="bucket-drawer-desktop-top hidden md:flex">
          <span className="bucket-drawer-grab" />
          <button type="button" className="bucket-icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
        </div>
        <h2 className="bucket-drawer-title text-2xl">{selected.metadata.name}</h2>
        <div className="bucket-drawer-when">
          {editingEventTime ? (
            <input type="date" aria-label="事件时间" className="bucket-field text-base" value={eventTimeVal.slice(0, 10)}
              onChange={e => setEventTimeVal(e.target.value + 'T00:00:00')}
              onBlur={e => {
                const date = e.currentTarget.value
                setEditingEventTime(false)
                if (date && date !== eventTime.slice(0, 10)) void onTraceOp(selected.id, { event_time: date + 'T00:00:00' })
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} autoFocus />
          ) : (
            <button type="button" className="bucket-drawer-date text-note" disabled={busy} title="点击修改事件时间"
              onClick={() => { setEventTimeVal(eventTime); setEditingEventTime(true) }}>{beijingTime(eventTime, true)}</button>
          )}
          <button type="button" className="bucket-id-chip text-meta" data-copied={idCopied} onClick={onCopyId} aria-label={idCopied ? 'ID 已复制' : '复制 ID'}>
            <span>{selected.id}</span><Icon name="copy" />
          </button>
          {actions.filter(action => action.active).map(action => <span key={action.label} className="bucket-state text-meta">{action.status}</span>)}
        </div>
        <div className="bucket-vitals text-meta">
          {editingImp ? (
            <label className="bucket-imp">IMP <input type="number" min={1} max={10} step={1} value={localImp} aria-label="重要度（1–10）" className="bucket-field text-base" autoFocus disabled={busy}
              onChange={e => setLocalImp(e.target.value)} onBlur={saveImportance} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingImp(false) }} /></label>
          ) : (
            <button type="button" className="bucket-imp" aria-label={'重要度 ' + selected.metadata.importance + '，点击编辑'} disabled={busy}
              onClick={() => { setLocalImp(String(selected.metadata.importance)); setEditingImp(true) }}>IMP <span className="bucket-imp-dots" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} data-filled={index < selected.metadata.importance} />)}</span></button>
          )}
          <span>V <b>{selected.metadata.valence?.toFixed(2).replace(/^0\./, '.') ?? '—'}</b></span>
          <span>A <b>{selected.metadata.arousal?.toFixed(2).replace(/^0\./, '.') ?? '—'}</b></span>
          <span>权重 <b>{selected.score?.toFixed(2) ?? '—'}</b></span>
          <span>激活 <b>{selected.metadata.activation_count ?? '—'}</b></span>
          <span>{{ dynamic: '动态', permanent: '永久', feel: 'feel', archived: '已归档' }[selected.metadata.type] ?? selected.metadata.type ?? '—'}</span>
        </div>

        <section className="bucket-paper" aria-label="记忆正文">
          <div className="bucket-paper-head text-meta">
            <span>{(editing ? editContent : selected.content).length} 字 · ~{Math.ceil((editing ? editContent : selected.content).length * 1.3)} tokens</span>
            {!editing && <div className="flex">
              <button type="button" className="bucket-icon-button" data-copied={contentCopied} aria-label={contentCopied ? '正文已复制' : '复制正文'} onClick={async () => {
                try { await navigator.clipboard.writeText(selected.content); setContentCopied(true); setCopyError('') }
                catch { setCopyError('复制失败，请重试') }
              }}><Icon name="copy" /></button>
              <button type="button" className="bucket-icon-button" aria-label="编辑正文" disabled={busy} onClick={() => onStartEdit(selected.content)}><Icon name="edit" /></button>
            </div>}
          </div>
          {editing ? <div className="bucket-paper-body">
            <textarea aria-label="记忆正文" className="bucket-content-editor text-base" rows={14} value={editContent} onChange={e => onStartEdit(e.target.value)} />
            <div className="flex justify-end items-center gap-3 mt-3 text-sm">
              <button type="button" onClick={onCancelEdit} disabled={saving}>取消</button>
              <button type="button" className="bucket-save" onClick={onSaveEdit} disabled={saving}>{saving ? '保存中' : '保存更改'}</button>
            </div>
          </div> : <div className="bucket-paper-body text-md">{selected.content}</div>}
          {copyError && <p role="alert" className="text-xs text-[var(--color-danger)] px-5 pb-2">{copyError}</p>}
          {(selected.metadata.domain?.length > 0 || selected.metadata.tags?.length > 0) && <div className="bucket-tags text-xs">
            {(selected.metadata.domain || []).map(domain => <span key={domain} className="bucket-domain">{domain}</span>)}
            {(selected.metadata.tags || []).map(tag => <span key={tag}>#{tag}</span>)}
          </div>}
        </section>

        {comments.length > 0 && <section className="bucket-rings" aria-label="年轮">
          <h3 className="text-xs">年轮</h3>
          {comments.map((comment, index) => <div key={comment.id || index} className="bucket-ring">
            {editingCommentId === comment.id ? <div>
              <textarea aria-label="年轮正文" className="bucket-field text-base w-full min-h-20" value={commentDraft} onChange={e => setCommentDraft(e.target.value)} autoFocus />
              <div className="flex justify-end gap-3 mt-2 text-xs">
                <button type="button" disabled={Boolean(commentOperatingId)} onClick={() => { setEditingCommentId(''); setCommentDraft('') }}>取消</button>
                <button type="button" className="bucket-save" disabled={!commentDraft.trim() || Boolean(commentOperatingId)} onClick={() => { if (comment.id) void mutateComment(comment.id, 'PATCH', commentDraft.trim()) }}>{commentOperatingId === comment.id ? '保存中…' : '保存'}</button>
              </div>
            </div> : <p className="text-sm whitespace-pre-wrap break-words">{comment.content}</p>}
            <div className="bucket-ring-meta text-meta">
              <time title={[comment.author, comment.kind].filter(Boolean).join(' · ')}>{beijingTime(comment.created || '')}</time>
              {comment.id && <>
                <button type="button" className="bucket-icon-button" aria-label="编辑年轮" disabled={Boolean(commentOperatingId)} onClick={() => { setEditingCommentId(comment.id || ''); setCommentDraft(comment.content || ''); setCommentError('') }}><Icon name="edit" /></button>
                <button type="button" className={armedDelete === comment.id ? 'bucket-erase text-xs' : 'bucket-icon-button'} data-armed={armedDelete === comment.id} aria-label="删除年轮" disabled={Boolean(commentOperatingId)} onClick={() => { if (comment.id) confirmDelete(comment.id, () => { void mutateComment(comment.id!, 'DELETE') }) }}>
                  <Icon name="delete" />{armedDelete === comment.id && <span>再点一次，删除年轮</span>}
                </button>
              </>}
            </div>
          </div>)}
          {commentError && <p role="alert" className="text-xs text-[var(--color-danger)]">{commentError}</p>}
        </section>}

        <section className="bucket-similar">
          <button type="button" className="bucket-similar-toggle text-xs" aria-expanded={similarOpen} onClick={() => setSimilarOpen(open => !open)}><Icon name="chevron" />相似记忆</button>
          {similarOpen && <div>
            {similarLoading ? <p className="text-xs py-3">查找相似记忆中…</p> : similarError ? <p role="alert" className="text-xs py-3 text-[var(--color-danger)]">{similarError}</p> : similarBuckets.length === 0 ? <p className="text-xs py-3">{embEnabled ? '未找到语义相似的记忆' : '嵌入引擎未启用（需配置 embedding 模型）'}</p> : similarBuckets.map(bucket => <a key={bucket.id} className="bucket-similar-row text-sm" href={'/memory?bucket=' + encodeURIComponent(bucket.id)}><span>{bucket.name || bucket.id}</span><em className="text-meta">{bucket.similarity?.toFixed(2)}</em></a>)}
          </div>}
        </section>
        <footer className="bucket-footer text-meta">
          <span>{beijingTime(selected.metadata.created)}{sourceLabel ? ' · ' + sourceLabel : ''}</span>
          <button type="button" className="bucket-erase text-xs" data-armed={armedDelete === 'bucket'} disabled={busy} onClick={() => confirmDelete('bucket', () => { void erase() })}><Icon name="delete" /><span>{deleting ? '处理中…' : armedDelete === 'bucket' ? '再点一次，移入回收站' : '抹除'}</span></button>
          {deleteError && <p role="alert" className="text-xs text-[var(--color-danger)]">{deleteError}</p>}
        </footer>
      </div>
      <nav className="bucket-action-bar" aria-label="记忆操作">
        {actions.map(action => <button key={action.label} type="button" className="bucket-action text-2xs" aria-pressed={action.status ? Boolean(action.active) : undefined} disabled={busy} onClick={action.run}>
          <span className="tab-pill"><Icon name={action.icon} /></span><span>{action.label}</span>
        </button>)}
      </nav>
    </div>
  )
}
