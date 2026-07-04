'use client'
import { useState, useEffect, useRef } from 'react'
import DetailPanel from './DetailPanel'
import { formatBeijingDateTime } from '@/app/utils/format'

// ==================== 类型定义 ====================
interface BucketDetail {
  id: string
  content: string
  score: number
  noise?: boolean  // resolved + importance==1, user-marked soft-delete
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
    wish?: boolean
    todo?: string
    todo_done?: boolean
    related?: string[]
    event_time?: string
  }
}

// ==================== Props ====================
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
  onConvertToJournal?: (id: string, args: { author: string; locked: boolean; unlock_hint: string }) => Promise<void>
}

export default function BucketDetailDrawer({
  selected,
  detailLoading,
  editing,
  editContent,
  saving,
  operating,
  copied,
  onClose,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onTraceOp,
  onCopyId,
  onImportanceChange,
  onTouch,
  onArchive,
  onActivate,
  onConvertToJournal,
}: Props) {
  // 内部缓存 importance 输入值
  const [localImp, setLocalImp] = useState<number | null>(null)
  // 设为日记的小表单
  const [showJournalForm, setShowJournalForm] = useState(false)
  const [journalAuthor, setJournalAuthor] = useState<'言之' | '小羊' | '共同'>('共同')
  const [journalLocked, setJournalLocked] = useState(false)
  const [journalUnlockHint, setJournalUnlockHint] = useState('')
  const [convertingToJournal, setConvertingToJournal] = useState(false)
  const [editingEventTime, setEditingEventTime] = useState(false); const [eventTimeVal, setEventTimeVal] = useState('')

  // Similar buckets & merge preview
  const [similarBuckets, setSimilarBuckets] = useState<any[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<any>(null)
  const [mergePreview, setMergePreview] = useState<any>(null)
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false)
  const [mergeCommitting, setMergeCommitting] = useState(false)
  const [embEnabled, setEmbEnabled] = useState(true)

  const fetchSimilar = async (id: string) => {
    setSimilarLoading(true)
    try {
      const res = await fetch(`/api/bucket/${id}/similar?n=5`)
      const data = await res.json()
      if (!data.error && data.items) {
        setSimilarBuckets(data.items)
        setEmbEnabled(data.embedding_enabled !== false)
      } else if (!data.error && Array.isArray(data)) {
        setSimilarBuckets(data) // backward compat
        setEmbEnabled(true)
      }
    } catch { }
    setSimilarLoading(false)
  }

  // Fetch similar buckets when selected changes
  const prevSelectedId = useRef<string | null>(null)
  useEffect(() => {
    if (selected && selected.id !== prevSelectedId.current) {
      prevSelectedId.current = selected.id
      setSimilarBuckets([])
      setMergeTarget(null)
      setMergePreview(null)
      fetchSimilar(selected.id)
    }
  }, [selected?.id])

  const doMergePreview = async (target: any) => {
    if (!selected) return
    setMergeTarget(target)
    setMergePreviewLoading(true)
    try {
      const res = await fetch(`/api/bucket/${selected.id}/merge-preview?into=${target.id}`, { method: 'POST' })
      const data = await res.json()
      setMergePreview(data)
    } catch { }
    setMergePreviewLoading(false)
  }

  const doMergeCommit = async () => {
    if (!selected || !mergeTarget || !mergePreview) return
    setMergeCommitting(true)
    try {
      const res = await fetch(`/api/bucket/${selected.id}/merge-commit?into=${mergeTarget.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merged_content: mergePreview.merged_content }),
      })
      const data = await res.json()
      if (data.ok) {
        setMergePreview(null)
        setMergeTarget(null)
        setSimilarBuckets(prev => prev.filter(b => b.id !== mergeTarget.id))
        onClose()
      }
    } catch { }
    setMergeCommitting(false)
  }

  return (
    <>
    <DetailPanel open={!!(selected || detailLoading)} onClose={onClose} mode="drawer" loading={detailLoading}>
      {selected ? (
          <div className="p-6 sm:p-8 overflow-y-auto h-full no-scrollbar">
            {/* 头部 */}
            <div className="flex items-start justify-between mb-6 pb-4 border-b border-[var(--color-border-light)]">
              <div className="pr-4">
                <div className="flex items-center gap-2 mb-1">
                  {selected.metadata.pinned && <span className="text-[var(--color-primary)] text-lg">★</span>}
                  <h2 className="text-xl sm:text-2xl font-bold text-[var(--color-text-heading)]">{selected.metadata.name}</h2>
                </div>
                <div className="text-xs text-[var(--color-text-tertiary)] mt-2 flex items-center gap-1 flex-wrap">
                  <span>事件:</span>
                  {editingEventTime ? (
                    <input
                      type="date"
                      className="text-xs px-1 py-0 border border-[var(--color-primary)] rounded bg-white outline-none"
                      value={eventTimeVal.slice(0, 10)}
                      onChange={e => setEventTimeVal(e.target.value + 'T00:00:00')}
                      onBlur={async () => {
                        setEditingEventTime(false)
                        if (eventTimeVal && eventTimeVal !== (selected.metadata.event_time || selected.metadata.created)) {
                          await onTraceOp(selected.id, { event_time: eventTimeVal })
                        }
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="cursor-pointer hover:text-[var(--color-primary)] hover:underline underline-offset-2 decoration-dotted"
                      onClick={() => {
                        setEventTimeVal(selected.metadata.event_time || selected.metadata.created || '')
                        setEditingEventTime(true)
                      }}
                      title="点击修改事件时间"
                    >
                      {formatBeijingDateTime(selected.metadata.event_time || selected.metadata.created || '') || '未设置'}
                    </span>
                  )}
                  <span>· 创建: {formatBeijingDateTime(selected.metadata.created)} · 修改: {formatBeijingDateTime(selected.metadata.last_active)}</span>
                </div>
              </div>
              <button onClick={onClose} className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] p-1.5 bg-[var(--color-surface-secondary)] rounded-full md:inline-flex hidden">✕</button>
            </div>

            {/* 信息胶囊 */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-white/60 backdrop-blur-sm border border-[var(--color-border)] shadow-sm rounded-lg px-2 py-2 text-center">
                <div className="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">IMP</div>
                <div className="h-5 flex items-center justify-center">
                  <input
                    type="number" min="0" max="10"
                    className="w-full text-sm font-bold text-[var(--color-primary)] outline-none text-center bg-transparent p-0 m-0 h-full border-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    defaultValue={selected.metadata.importance ?? ''}
                    disabled={operating}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value)
                      if (isNaN(val) || val === selected.metadata.importance) return
                      if (onImportanceChange) onImportanceChange(selected.id, val)
                    }}
                  />
                </div>
              </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[var(--color-border)] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">权重</div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">{selected.score?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[var(--color-border)] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">激活</div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">{selected.metadata.activation_count ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[var(--color-border)] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">效价 V</div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">{selected.metadata.valence?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[var(--color-border)] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">唤醒 A</div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">{selected.metadata.arousal?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[var(--color-border)] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">类型</div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {{ dynamic: '动态', permanent: '永久', feel: 'feel', archived: '已归档' }[selected.metadata.type] ?? selected.metadata.type ?? '—'}
                  </div>
                </div>
              </div>

            {/* 标签 */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {(selected.metadata.domain ?? []).map(d => (
                <span key={d} className="text-xs bg-[#EFECE6] px-2.5 py-1 rounded-md text-[var(--color-text-secondary)]">{d}</span>
              ))}
              {(selected.metadata.tags ?? []).map(t => (
                <span key={t} className="text-xs border border-[var(--color-border)] px-2.5 py-1 rounded-md text-[var(--color-text-secondary)]">{t}</span>
              ))}
            </div>

            {/* 操作按钮组 */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { pinned: selected.metadata.pinned ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.pinned ? 'bg-[var(--color-pinned-bg)] text-[var(--color-primary)]' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {selected.metadata.pinned ? '已钉选' : '钉 选'}
              </button>
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { digested: selected.metadata.digested ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.digested ? 'bg-[var(--color-digested-bg)] text-[var(--color-digested)]' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {selected.metadata.digested ? '已消化' : '消 化'}
              </button>
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { resolved: selected.metadata.resolved ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.resolved
                    ? 'bg-[var(--color-resolved-bg)] text-[var(--color-resolved)]'
                    : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {selected.metadata.resolved ? '已解决' : '解 决'}
              </button>
              <button disabled={operating}
                onClick={() => onArchive(selected.id)}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.type === 'archived' ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)]' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {selected.metadata.type === 'archived' ? '已归档' : '归 档'}
              </button>
              <button disabled={operating}
                onClick={() => onTouch(selected.id)}
                className="text-xs py-2 rounded-lg font-medium bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors disabled:opacity-50">
                轻 触
              </button>
              <button disabled={operating}
                onClick={() => onActivate(selected.id)}
                className="text-xs py-2 rounded-lg font-medium bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors disabled:opacity-50">
                激 活
              </button>
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { wish: selected.metadata.wish ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.wish ? 'bg-[var(--color-wish-bg)] text-[var(--color-wish)]' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {selected.metadata.wish ? '已悬念' : '标悬念'}
              </button>
              {/* Noise toggle: marks as resolved+imp=1 (excluded from searches) */}
              <button disabled={operating}
                onClick={() => {
                  const isNoise = selected.noise || (selected.metadata.resolved && selected.metadata.importance === 1)
                  if (isNoise) {
                    onTraceOp(selected.id, { resolved: false })
                  } else {
                    onTraceOp(selected.id, { resolved: true, importance: 1 })
                  }
                }}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  (selected.noise || (selected.metadata.resolved && selected.metadata.importance === 1))
                    ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-tertiary)] line-through'
                    : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
                }`}>
                {(selected.noise || (selected.metadata.resolved && selected.metadata.importance === 1)) ? '已噪声' : '标噪声'}
              </button>
            </div>

            {/* 待办 */}
            <div className="flex items-center gap-3 bg-white/60 backdrop-blur-sm border border-[var(--color-border)] rounded-xl px-4 py-2.5 mb-4">
              <input
                type="checkbox"
                checked={!!selected.metadata.todo_done}
                disabled={operating || !selected.metadata.todo}
                onChange={() => onTraceOp(selected.id, { todo_done: selected.metadata.todo_done ? 0 : 1 })}
                className="accent-[var(--color-primary)] w-4 h-4 flex-shrink-0"
              />
              <input
                key={selected.id}
                type="text"
                placeholder="写点待办…"
                defaultValue={selected.metadata.todo ?? ''}
                disabled={operating}
                onBlur={(e) => {
                  if (e.target.value === (selected.metadata.todo ?? '')) return
                  onTraceOp(selected.id, { todo: e.target.value })
                }}
                className={`flex-1 text-sm bg-transparent outline-none ${
                  selected.metadata.todo_done ? 'line-through text-[var(--color-text-disabled)]' : 'text-[var(--color-text-primary)]'
                }`}
              />
            </div>

                        {/* 内容区 */}
            {!editing ? (
              <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-border-light)] rounded-xl overflow-hidden mb-4">
                <div className="flex justify-between items-center px-5 pt-3 pb-2 border-b border-[var(--color-border-light)]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--color-text-disabled)] uppercase tracking-wider">内容</span>
                    <span className="text-[10px] text-[#C4896A] font-mono">
                      {selected.content.length} 字 · ~{Math.ceil(selected.content.length * 1.3)} tokens
                    </span>
                  </div>
                  <button onClick={() => onStartEdit(selected.content)} className="text-xs text-[var(--color-primary)] font-medium hover:text-[var(--color-primary-hover)]">编辑</button>
                </div>
                <div className="p-5 text-sm leading-loose whitespace-pre-wrap">
                  {selected.content}
                </div>
              </div>
            ) : (
              <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-primary)] rounded-xl p-4 mb-4">
                <textarea
                  className="w-full bg-transparent text-sm leading-relaxed resize-none outline-none"
                  rows={14}
                  value={editContent}
                  onChange={e => onStartEdit(e.target.value)}
                />
                <div className="flex justify-between items-center mt-3">
                  <span className="text-[10px] text-[#C4896A] font-mono">
                    {editContent.length} 字 · ~{Math.ceil(editContent.length * 1.3)} tokens
                  </span>
                  <div className="flex gap-2">
                    <button onClick={onCancelEdit} className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">取消</button>
                    <button onClick={onSaveEdit} disabled={saving}
                      className="text-sm bg-[var(--color-primary)] text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{saving ? '保存中' : '保存更改'}</button>
                  </div>
                </div>
              </div>
            )}

            {/* 设为日记 */}
            {onConvertToJournal && (
              <div className="mb-4">
                {showJournalForm ? (
                  <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-xl p-4">
                    <div className="text-xs text-[var(--color-text-disabled)] mb-3">
                      转为日记后会移出常规记忆库，只能在日记页编辑，不可逆。
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      {(['言之', '小羊', '共同'] as const).map(a => (
                        <button key={a} onClick={() => setJournalAuthor(a)}
                          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                            journalAuthor === a ? 'bg-[var(--color-pinned-bg)] text-[var(--color-primary)]' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]'
                          }`}>
                          {a}
                        </button>
                      ))}
                      <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer ml-2">
                        <input type="checkbox" checked={journalLocked} onChange={e => setJournalLocked(e.target.checked)} className="accent-[var(--color-primary)]" />
                        上锁
                      </label>
                    </div>
                    {journalLocked && (
                      <input
                        value={journalUnlockHint}
                        onChange={e => setJournalUnlockHint(e.target.value)}
                        placeholder="解锁提示（日期到点自动解锁，其他文本保持锁定）"
                        className="w-full text-xs border border-[var(--color-border)] rounded-lg px-3 py-2 mb-3 outline-none focus:border-[var(--color-primary)]"
                      />
                    )}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowJournalForm(false)} className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">取消</button>
                      <button
                        disabled={convertingToJournal}
                        onClick={async () => {
                          if (!confirm('确定把这个桶转为日记？转换后不可恢复为常规记忆。')) return
                          setConvertingToJournal(true)
                          await onConvertToJournal(selected.id, { author: journalAuthor, locked: journalLocked, unlock_hint: journalUnlockHint })
                          setConvertingToJournal(false)
                          setShowJournalForm(false)
                          onClose()
                        }}
                        className="text-sm bg-[var(--color-primary)] text-white px-4 py-1.5 rounded-lg disabled:opacity-50 hover:bg-[var(--color-primary-hover)]"
                      >
                        {convertingToJournal ? '转换中…' : '确认转为日记'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowJournalForm(true)} className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] underline">
                    设为日记
                  </button>
                )}
              </div>
            )}

            {/* Similar Buckets / 相似记忆 */}
            <div className="mb-4 bg-white border border-[var(--color-border)] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[var(--color-text-disabled)] uppercase tracking-wider">相似记忆</span>
                <button
                  onClick={() => fetchSimilar(selected!.id)}
                  disabled={similarLoading}
                  className="text-xs text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium disabled:opacity-50"
                >
                  {similarLoading ? '查找中...' : '重新查找'}
                </button>
              </div>
              {similarLoading ? (
                <div className="text-xs text-[var(--color-text-disabled)]">查找相似记忆中…</div>
              ) : similarBuckets.length === 0 ? (
                <div className="text-xs text-[var(--color-text-disabled)]">
                  {embEnabled
                    ? '未找到语义相似的记忆'
                    : '嵌入引擎未启用（需配置 embedding 模型）'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {similarBuckets.map((b: any) => (
                    <div key={b.id} className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-[var(--color-primary)] font-mono">{b.similarity?.toFixed(2)}</span>
                      <span className="flex-1 truncate text-[var(--color-text-primary)]">{b.name || b.id}</span>
                      <button
                        onClick={() => doMergePreview(b)}
                        disabled={operating || mergePreviewLoading}
                        className="text-xs text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] font-medium disabled:opacity-50"
                      >
                        合并预览
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 抹除和索引 */}
            <div className="flex justify-between items-center">
              <button onClick={() => { if (confirm('确定抹除此记忆？将移入回收站。')) { onTraceOp(selected.id, { delete: true }).then(onClose) } }}
                className="text-sm text-[var(--color-danger)] font-medium hover:text-red-700">抹除</button>
              <div onClick={onCopyId} className="inline-flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--color-border-light)] px-3 py-1.5 rounded-full">
                <span className="text-[var(--color-text-disabled)]">索引: {selected.id}</span>
                <span className={`${copied ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-disabled)]'}`}>{copied ? '已复制' : '复制'}</span>
              </div>
            </div>
          </div>
        ) : null}
    </DetailPanel>

    {/* Merge Preview Modal */}
    <DetailPanel open={!!(mergePreview && mergeTarget)} onClose={() => { setMergePreview(null); setMergeTarget(null) }} mode="modal" width="max-w-[960px]">
      {mergePreviewLoading ? (
        <div className="text-center py-16 text-[var(--color-text-disabled)]">生成合并预览中...</div>
      ) : mergePreview?.error ? (
        <div className="text-red-500 text-sm">{mergePreview.error}</div>
      ) : mergePreview ? (
        <>
          {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2 text-base">
                  <span className="text-[var(--color-text-disabled)] line-through">{mergePreview.a?.name || selected?.id}</span>
                  <span className="text-[var(--color-text-divider)]">{'->'}</span>
                  <span className="text-[var(--color-text-primary)] font-semibold">{mergePreview.b?.name || mergeTarget.id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--color-text-tertiary)]">新桶重要度 <b className="text-[var(--color-primary)]">{mergePreview.importance ?? '--'}</b></span>
                  <button onClick={() => { setMergePreview(null); setMergeTarget(null) }}
                    className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] text-lg p-1 leading-none">x</button>
                </div>
              </div>

              {/* Three columns */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {/* Source */}
                <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--color-border-light)] bg-[var(--color-bg)] flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--color-text-tertiary)]">{mergePreview.a?.name || selected?.id}</span>
                    <span className="text-xs text-[var(--color-text-disabled)]">{mergePreview.a_chars ?? 0} 字</span>
                  </div>
                  <div className="p-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                    {mergePreview.a_content}
                  </div>
                </div>
                {/* Target */}
                <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--color-border-light)] bg-[var(--color-bg)] flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--color-text-tertiary)]">{mergePreview.b?.name || mergeTarget.id}</span>
                    <span className="text-xs text-[var(--color-text-disabled)]">{mergePreview.b_chars ?? 0} 字</span>
                  </div>
                  <div className="p-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                    {mergePreview.b_content}
                  </div>
                </div>
                {/* Merged */}
                <div className="border border-[var(--color-primary)]/30 rounded-xl overflow-hidden bg-[#FDF9F7]">
                  <div className="px-3 py-2 border-b border-[var(--color-border-light)] flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--color-primary)]">合并后</span>
                    <span className="text-xs text-[var(--color-primary)]">{mergePreview.merged_chars ?? 0} 字</span>
                  </div>
                  <div className="p-3 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                    {mergePreview.merged_content}
                  </div>
                </div>
              </div>

              {/* Cost */}
              {mergePreview.cost?.known && (
                <div className="text-xs text-[var(--color-text-tertiary)] mb-5 bg-[var(--color-surface-secondary)] rounded-lg px-3 py-2">
                  预估成本: ${mergePreview.cost.usd} (约 {mergePreview.cost.cny} cny) | {mergePreview.cost.in_tokens} / {mergePreview.cost.out_tokens} tokens
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setMergePreview(null); setMergeTarget(null) }}
                  className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] px-4 py-2 rounded-lg border border-[var(--color-border)] transition-colors">拒绝</button>
                <button onClick={() => doMergePreview(mergeTarget)} disabled={mergePreviewLoading}
                  className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-4 py-2 rounded-lg border border-[var(--color-border)] transition-colors">
                  {mergePreviewLoading ? '重做中...' : '重做'}
                </button>
                <button onClick={doMergeCommit} disabled={mergeCommitting}
                  className="text-sm bg-[var(--color-primary)] text-white px-5 py-2 rounded-lg hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors">
                  {mergeCommitting ? '合并中...' : '确认合并'}
                </button>
              </div>
            </>
          ) : null}
    </DetailPanel>
    </>
  )
}
