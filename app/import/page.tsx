'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import NavBar from '../components/NavBar'
import Link from 'next/link'
import Stat from '../components/Stat'

interface ImportStatus {
  status: string
  source_file?: string; total_chunks?: number; processed?: number
  api_calls?: number; memories_created?: number; memories_merged?: number
  total_cost_usd?: number; total_in_tokens?: number; total_out_tokens?: number
  last_llm_model?: string; errors?: string[]; error?: string
}

interface ImportResultItem {
  id: string; name: string; content: string; type: string
  domain: string[]; tags: string[]; importance: number; created: string
}

export default function ImportPage() {
  const [dragOver, setDragOver] = useState(false)
  const [mode, setMode] = useState<'large' | 'small'>('large')
  const [maxChunks, setMaxChunks] = useState(0)
  const [dryRun, setDryRun] = useState(false)
  const [textPaste, setTextPaste] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)
  const [polling, setPolling] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Post-import review
  const [reviewItems, setReviewItems] = useState<ImportResultItem[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [reviewActions, setReviewActions] = useState<Record<string, 'keep' | 'noise' | 'delete'>>({})

  const startPolling = useCallback(() => {
    setPolling(true)
    let previousStatus = ''
    const poll = async () => {
      try {
        const res = await fetch('/api/import-status')
        const data = await res.json()
        setImportStatus(data)
        if (!data.error && (data.status === 'completed' || data.status === 'error' || data.status === 'idle')) {
          stopPolling()
          if (data.status === 'completed') fetchReviewItems()
        }
        previousStatus = data.status
      } catch { }
    }
    poll()
    statusIntervalRef.current = setInterval(poll, 2000)
  }, [])

  const stopPolling = useCallback(() => {
    setPolling(false)
    if (statusIntervalRef.current) { clearInterval(statusIntervalRef.current); statusIntervalRef.current = null }
  }, [])

  const fetchReviewItems = async () => {
    setReviewLoading(true)
    try {
      const res = await fetch('/api/import-results?limit=50')
      const data = await res.json()
      if (data.buckets) {
        setReviewItems(data.buckets)
        setChecked(new Set(data.buckets.map((b: ImportResultItem) => b.id)))
        setReviewActions({})
      }
    } catch { }
    setReviewLoading(false)
  }

  useEffect(() => { return () => stopPolling() }, [stopPolling])

  const doUpload = async (content: string | File, isFile: boolean, filename?: string) => {
    setUploading(true); setImportStatus(null); setReviewItems([]); setChecked(new Set()); setReviewActions({})
    stopPolling()
    try {
      const params = new URLSearchParams()
      params.set('mode', mode); params.set('max_chunks', dryRun ? '3' : String(maxChunks))
      let res: Response
      if (isFile && content instanceof File) {
        const form = new FormData(); form.set('file', content, filename || (content as File).name)
        res = await fetch(`/api/import-upload?${params}`, { method: 'POST', body: form })
      } else {
        params.set('filename', filename || 'paste.txt')
        res = await fetch(`/api/import-upload?${params}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: String(content) })
      }
      const data = await res.json()
      if (data.error) { setImportStatus(data) } else { startPolling() }
    } catch (e) { setImportStatus({ status: 'error', error: String(e) }) }
    finally { setUploading(false) }
  }

  const handleFileDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files[0]; if (file) doUpload(file, true, file.name) }
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) doUpload(file, true, file.name) }
  const handlePasteSubmit = () => { if (!textPaste.trim()) return; doUpload(textPaste, false); setTextPaste(''); setShowPaste(false) }

  const toggleCheck = (id: string) => {
    setChecked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const setAction = (id: string, action: 'keep' | 'noise' | 'delete') => {
    setReviewActions(prev => ({ ...prev, [id]: action }))
  }

  const applyReviews = async (actions?: Record<string, 'keep' | 'noise' | 'delete'>) => {
    const toApply = actions || reviewActions
    for (const [id, action] of Object.entries(toApply)) {
      if (action === 'noise') {
        await fetch('/api/edit-bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, resolved: true, importance: 1 }) })
      } else if (action === 'delete') {
        await fetch('/api/edit-bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, delete: true }) })
      }
    }
    setReviewItems(prev => prev.filter(b => !toApply[b.id] || toApply[b.id] === 'keep'))
    setReviewActions({})
  }

  const formatTokens = (n: number | undefined) => { if (!n) return '—'; if (n >= 1000) return `${(n / 1000).toFixed(1)}k`; return String(n) }

  const isRunning = importStatus?.status === 'running'
  const isComplete = importStatus?.status === 'completed'
  const progressPct = importStatus && importStatus.total_chunks ? Math.round((importStatus.processed || 0) / importStatus.total_chunks * 100) : 0

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] font-sans pb-20">
      <NavBar activeSlug="import" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12">
        <h1 className="text-2xl font-bold mb-2 text-[var(--color-text-heading)]">导入记忆</h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-6">
          支持 Claude JSON、ChatGPT 导出、DeepSeek、Markdown、纯文本。LLM 会自动提取并脱水为记忆桶。
        </p>

        {/* Mode selector + Dry run */}
        {!isRunning && !isComplete && (
          <>
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="flex items-center gap-2 bg-white border border-[var(--color-border)] rounded-xl px-3 py-2">
              <span className="text-xs text-[var(--color-text-disabled)]">模式</span>
              <button onClick={() => setMode('large')}
                className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${mode === 'large' ? 'bg-[var(--color-text-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}`}>大批量</button>
              <button onClick={() => setMode('small')}
                className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${mode === 'small' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'}`}>小分量补漏</button>
            </div>
            <label className="flex items-center gap-2 bg-white border border-[var(--color-border)] rounded-xl px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="accent-[var(--color-primary)] w-3.5 h-3.5" />
              <span className="text-xs text-[var(--color-text-secondary)]">试跑模式（仅3块）</span>
            </label>
          </div>

          {/* Upload area */}
          <div className="space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`bg-white border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragOver ? 'border-[var(--color-primary)] bg-[var(--color-pinned-bg)]/30' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'}`}>
              <div className="text-3xl mb-3">📁</div>
              <div className="text-sm font-medium text-[var(--color-text-primary)] mb-1">{uploading ? '上传中…' : '拖拽文件到此处，或点击选择'}</div>
              <div className="text-xs text-[var(--color-text-disabled)]">支持 JSON · Markdown · TXT · ZIP</div>
              <input ref={fileInputRef} type="file" accept=".json,.md,.txt,.zip" className="hidden" onChange={handleFileSelect} />
            </div>
            {!showPaste ? (
              <button onClick={() => setShowPaste(true)} className="w-full text-center text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] py-2 transition-colors">或直接粘贴文本</button>
            ) : (
              <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
                <textarea value={textPaste} onChange={e => setTextPaste(e.target.value)} placeholder="粘贴对话记录或文本内容…" rows={8} className="w-full border border-[var(--color-border)] rounded-lg p-3 text-sm outline-none focus:border-[var(--color-primary)] resize-y" />
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => { setShowPaste(false); setTextPaste('') }} className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">取消</button>
                  <button onClick={handlePasteSubmit} disabled={!textPaste.trim() || uploading} className="text-sm bg-[var(--color-primary)] text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{uploading ? '导入中…' : '开始导入'}</button>
                </div>
              </div>
            )}
          </div>
          </>
        )}

        {/* Progress banner */}
        {(isRunning || polling) && importStatus && (
          <div className="bg-white border border-[var(--color-border)] rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">{isRunning ? '导入中…' : '✅ 导入完成'}</span>
              {importStatus.source_file && <span className="text-xs text-[var(--color-text-disabled)] truncate max-w-[200px]">{importStatus.source_file}</span>}
            </div>
            {importStatus.total_chunks && importStatus.total_chunks > 0 && (
              <div>
                <div className="flex justify-between text-xs text-[var(--color-text-tertiary)] mb-1.5"><span>块 {importStatus.processed}/{importStatus.total_chunks}</span><span>{progressPct}%</span></div>
                <div className="w-full bg-[var(--color-border-subtle)] rounded-full h-2"><div className="h-2 rounded-full bg-[var(--color-primary)] transition-all duration-500" style={{ width: `${progressPct}%` }} /></div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="新建记忆" value={importStatus.memories_created ?? '—'} />
              <Stat label="合并记忆" value={importStatus.memories_merged ?? '—'} />
              <Stat label="API 调用" value={importStatus.api_calls ?? '—'} />
              <Stat label="成本" value={importStatus.total_cost_usd != null ? `$${importStatus.total_cost_usd.toFixed(4)}` : '—'} />
              <Stat label="模型" value={importStatus.last_llm_model?.split('-').slice(0, 2).join('-') || '—'} />
              <Stat label="输入 tokens" value={formatTokens(importStatus.total_in_tokens)} />
              <Stat label="输出 tokens" value={formatTokens(importStatus.total_out_tokens)} />
              <Stat label="CNY 估算" value={importStatus.total_cost_usd != null ? `¥${(importStatus.total_cost_usd * 7.2).toFixed(2)}` : '—'} />
            </div>
            {importStatus.errors && importStatus.errors.length > 0 && (
              <div className="bg-[var(--color-pinned-bg)] border border-[#F5D5CB] rounded-xl p-3">
                <div className="text-xs font-medium text-[var(--color-primary)] mb-1">错误 ({importStatus.errors.length})</div>
                <div className="text-xs text-[var(--color-text-tertiary)] max-h-24 overflow-y-auto space-y-0.5">{importStatus.errors.slice(-5).map((e, i) => <div key={i} className="truncate">{e}</div>)}</div>
              </div>
            )}
            {importStatus.error && <div className="bg-[var(--color-pinned-bg)] border border-[#F5D5CB] rounded-xl p-3 text-xs text-[var(--color-primary)]">{importStatus.error}</div>}
          </div>
        )}

        {/* Completion — Review imported items */}
        {isComplete && !polling && reviewItems.length > 0 && (
          <div className="space-y-3 mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-heading)]">审查导入结果</h2>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  已创建 {reviewItems.length} 条记忆 · 勾选保留，未勾选的将标记为噪声
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => {
                  const newActions: Record<string, 'keep' | 'noise' | 'delete'> = {}
                  for (const b of reviewItems) {
                    if (!checked.has(b.id)) newActions[b.id] = 'noise'
                  }
                  setReviewActions(newActions)
                  applyReviews(newActions)
                }} disabled={reviewLoading}
                  className="text-sm bg-[var(--color-text-primary)] text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  应用所有标记
                </button>
              </div>
            </div>

            {reviewLoading ? (
              <div className="text-center text-[var(--color-text-disabled)] py-20">加载导入结果…</div>
            ) : (
              <>
                {reviewItems.map(b => (
                  <div key={b.id} className={`bg-white border rounded-xl px-4 py-3 flex items-start gap-3 transition-all ${reviewActions[b.id] === 'noise' ? 'opacity-40 border-[var(--color-border)]' : reviewActions[b.id] === 'delete' ? 'opacity-30 line-through border-[var(--color-border)]' : 'border-[var(--color-border)]'}`}>
                    <input type="checkbox" checked={checked.has(b.id)} onChange={() => toggleCheck(b.id)}
                      className="mt-1 accent-[var(--color-primary)] w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{b.name || b.id}</div>
                      <div className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{b.content}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-[var(--color-text-disabled)]">{b.id}</span>
                        {(b.domain || []).map((d: string) => <span key={d} className="text-xs bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 rounded text-[var(--color-text-secondary)]">{d}</span>)}
                        <span className="text-xs text-[var(--color-text-disabled)]">imp {b.importance}</span>
                      </div>
                    </div>
                    <select
                      value={reviewActions[b.id] || 'keep'}
                      onChange={e => setAction(b.id, e.target.value as any)}
                      className="text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-white outline-none flex-shrink-0"
                    >
                      <option value="keep">保留</option>
                      <option value="noise">标噪声</option>
                      <option value="delete">删除</option>
                    </select>
                  </div>
                ))}

                {Object.keys(reviewActions).length > 0 && (
                  <div className="flex justify-end">
                    <button onClick={() => applyReviews()}
                      className="text-sm bg-[var(--color-primary)] text-white px-6 py-2 rounded-xl hover:bg-[var(--color-primary-hover)] transition-colors">
                      应用 ({Object.keys(reviewActions).length} 条变更)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Empty complete state */}
        {isComplete && !polling && reviewItems.length === 0 && !reviewLoading && (
          <div className="text-center py-12 mt-6">
            <div className="text-5xl mb-4">✅</div>
            <div className="text-lg font-semibold text-[var(--color-text-heading)] mb-2">导入完成</div>
            <div className="text-sm text-[var(--color-text-tertiary)] mb-6">
              共创建 {importStatus?.memories_created ?? 0} 条记忆，合并 {importStatus?.memories_merged ?? 0} 条
              {importStatus?.total_cost_usd != null && <span> · 花费 ${importStatus.total_cost_usd.toFixed(4)}</span>}
            </div>
            <button onClick={() => { setImportStatus(null); setReviewItems([]) }}
              className="text-sm bg-[var(--color-text-primary)] text-white px-6 py-2 rounded-xl mr-3 hover:opacity-80 transition-colors">
              再次导入
            </button>
            <Link href="/" className="text-sm bg-[var(--color-primary)] text-white px-6 py-2 rounded-xl hover:bg-[var(--color-primary-hover)] transition-colors inline-block">回到主页</Link>
          </div>
        )}
      </main>
    </div>
  )
}
