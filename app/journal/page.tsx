'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import NavBar from '../components/NavBar'
import DetailPanel from '../components/DetailPanel'
import SearchBar from '../components/SearchBar'
import TagPill from '../components/TagPill'
import { formatBeijingDate, formatBeijingDateTime, getBeijingDayOfWeek } from '@/app/utils/format'

interface JournalEntry {
  id: string
  name: string
  author: string
  created: string
  locked: boolean
  content: string | null
  unlock_hint?: string
}

interface JournalDetailMeta {
  name: string
  created: string
  last_active: string
  [key: string]: unknown
}

interface BucketDetailResponse {
  id: string
  content: string
  score?: number
  metadata: JournalDetailMeta
}

type Author = '言之' | '小羊' | '共同'

function formatJournalDate(dateStr: string): string {
  const datePart = formatBeijingDate(dateStr)
  if (datePart === '—') return '—'
  const dayOfWeek = getBeijingDayOfWeek(dateStr)
  const parts = datePart.split('/')
  const day = parseInt(parts[2], 10)
  const monthNum = parseInt(parts[1], 10) - 1
  const year = parts[0]
  const monthShort = new Date(Date.UTC(2000, monthNum)).toLocaleDateString('en', { month: 'short' })
  return `${day} ${monthShort} ${year} · ${dayOfWeek}`
}

function stats(text: string) {
  return { chars: text.length, tokens: Math.ceil(text.length * 1.3) }
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ---- 筛选 ----
  const [search, setSearch] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')

  // ---- 详情弹窗 ----
  const [detail, setDetail] = useState<{
    entry: JournalEntry
    meta: JournalDetailMeta | null
    fullContent: string
  } | null>(null)
  const [detailFetching, setDetailFetching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // ---- 写新日记弹窗 ----
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newAuthor, setNewAuthor] = useState<Author>('共同')
  const [newLocked, setNewLocked] = useState(false)
  const [newUnlockHint, setNewUnlockHint] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/journal')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '读取失败')
      setEntries(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ---- 筛选逻辑 ----
  const filtered = useMemo(() => {
    let arr = entries
    // 文本搜索
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      arr = arr.filter(e => e.name?.toLowerCase().includes(q) || e.content?.toLowerCase().includes(q))
    }
    // 日期筛选
    if (dateStart || dateEnd) {
      const s = dateStart ? new Date(dateStart).getTime() : 0
      const e = dateEnd ? new Date(dateEnd).getTime() + 86400000 : Infinity
      arr = arr.filter(item => {
        const t = new Date(item.created).getTime()
        return t >= s && t <= e
      })
    }
    return arr
  }, [entries, search, dateStart, dateEnd])

  // 按日记日期分组
  const dateGroups = useMemo(() => {
    const groups = new Map<string, JournalEntry[]>()
    for (const e of filtered) {
      const date = formatBeijingDate(e.created)
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(e)
    }
    for (const [, list] of groups) {
      list.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  // ---- 统计 ----
  const statsSummary = useMemo(() => {
    const yz = entries.filter(e => e.author === '言之').length
    const xy = entries.filter(e => e.author === '小羊').length
    const gt = entries.filter(e => e.author === '共同').length
    return { 言之: yz, 小羊: xy, 共同: gt, total: entries.length }
  }, [entries])

  // ---- 详情弹窗操作 ----
  const openDetail = async (entry: JournalEntry) => {
    setEditing(false)
    setDetail({ entry, meta: null, fullContent: entry.content ?? '' })
    setDetailFetching(true)
    try {
      const res = await fetch(`/api/bucket/${entry.id}`)
      if (res.ok) {
        const data: BucketDetailResponse = await res.json()
        setDetail({
          entry,
          meta: data.metadata ?? null,
          fullContent: data.content ?? entry.content ?? '',
        })
      }
    } catch { /* 静默失败 */ }
    setDetailFetching(false)
  }

  const closeDetail = () => {
    setDetail(null)
    setEditing(false)
    setCopied(false)
  }

  const saveEdit = async () => {
    if (!detail) return
    setSaving(true)
    try {
      await fetch('/api/edit-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: detail.entry.id, content: editContent }),
      })
      setEditing(false)
      const res = await fetch(`/api/bucket/${detail.entry.id}`)
      if (res.ok) {
        const data: BucketDetailResponse = await res.json()
        setDetail({
          entry: { ...detail.entry, content: data.content },
          meta: data.metadata ?? detail.meta,
          fullContent: data.content,
        })
      }
      await load()
    } catch (e) {
      console.error('保存失败', e)
    }
    setSaving(false)
  }

  const deleteJournal = async () => {
    if (!detail || !confirm('确定抹除此日记？不可恢复。')) return
    try {
      await fetch('/api/edit-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: detail.entry.id, delete: true }),
      })
      closeDetail()
      await load()
    } catch (e) {
      console.error('删除失败', e)
    }
  }

  const copyId = () => {
    if (!detail) return
    navigator.clipboard.writeText(detail.entry.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // ---- 新建日记操作 ----
  const submitNew = async () => {
    if (!newContent.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newContent,
          name: newName.trim() || undefined,
          author: newAuthor,
          locked: newLocked,
          unlock_hint: newLocked ? newUnlockHint : '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '创建失败')
      setShowAdd(false)
      setNewName('')
      setNewContent('')
      setNewAuthor('共同')
      setNewLocked(false)
      setNewUnlockHint('')
      await load()
    } catch (e) {
      setError(String(e))
    }
    setSubmitting(false)
  }

  const resetNewForm = () => {
    setNewName('')
    setNewContent('')
    setNewAuthor('共同')
    setNewLocked(false)
    setNewUnlockHint('')
  }

  const authorColor = (a: string) =>
    a === '言之' ? 'bg-[var(--color-pinned-bg)] text-[var(--color-primary)]'
    : a === '小羊' ? 'bg-[var(--color-resolved-bg)] text-[var(--color-resolved)]'
    : 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)]'

  // ============ 渲染 ============

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <style>{`
        .tl-line { position: absolute; left: 20px; top: 0; bottom: 0; width: 2px; background: linear-gradient(to bottom, #E8D5C4, #E8D5C4 75%, transparent); }
        .tl-dot { position: relative; z-index: 1; width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; background: var(--color-primary); box-shadow: 0 0 0 3px var(--color-bg); }
        .tl-card { background: #FFFFFF; border: 1px solid var(--color-border-light); border-radius: 16px; transition: all 0.2s ease; cursor: pointer; }
        .tl-card:hover { box-shadow: 0 4px 16px rgba(180,160,140,0.15); transform: translateY(-1px); }
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #D4C9BD; border-radius: 4px; }
      `}</style>

      {/* ===== 顶部导航 ===== */}
      <NavBar activeSlug="journal" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24">

        {/* ===== 标题栏 ===== */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight">日记</h1>
        </div>

        {/* ===== 统计条 ===== */}
        <div className="flex items-center gap-4 mb-5 text-xs">
          <span className="font-medium text-[var(--color-primary)]">{statsSummary.言之} 篇<span className="text-[var(--color-text-disabled)] ml-1">言之</span></span>
          <span className="font-medium text-[var(--color-resolved)]">{statsSummary.小羊} 篇<span className="text-[var(--color-text-disabled)] ml-1">小羊</span></span>
          <span className="font-medium text-[var(--color-text-tertiary)]">{statsSummary.共同} 篇<span className="text-[var(--color-text-disabled)] ml-1">共同</span></span>
          <span className="text-[#B0A590]">共 {statsSummary.total} 篇</span>
        </div>

        {/* ===== 搜索 ===== */}
        <div className="mb-3">
          <SearchBar value={search} onChange={setSearch} placeholder="搜索日记标题或内容..." />
        </div>

        {/* ===== 日期筛选（右下角） ===== */}
        <div className="flex items-center justify-end gap-2 mb-5">
          <div className="flex items-center bg-white border border-[var(--color-border)] rounded-lg overflow-hidden" style={{ fontSize: 0 }}>
            <div className="border-r border-[var(--color-border)]">
              <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
                className="text-xs px-2.5 py-1.5 outline-none bg-transparent focus:text-[var(--color-primary)] transition-colors" />
            </div>
            <span className="text-[10px] text-[var(--color-text-disabled)] px-1.5">至</span>
            <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
              className="text-xs px-2.5 py-1.5 outline-none bg-transparent focus:text-[var(--color-primary)] transition-colors" />
          </div>
          <span className="text-xs text-[var(--color-text-disabled)]">{filtered.length} 篇</span>
        </div>

        {/* ===== 错误提示 ===== */}
        {error && (
          <div className="mb-5 text-sm text-[var(--color-danger)] bg-[#FDEDEC] border border-[#F3C9C6] rounded-lg px-4 py-2.5 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-[var(--color-danger)] opacity-60 hover:opacity-100 ml-3">✕</button>
          </div>
        )}

        {/* ===== 加载状态 ===== */}
        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="flex-shrink-0 w-[42px] flex flex-col items-center pt-1">
                  <div className="w-[18px] h-[18px] rounded-full bg-[var(--color-border)]" />
                </div>
                <div className="flex-1">
                  <div className="h-4 w-24 bg-[var(--color-border)] rounded mb-3" />
                  <div className="h-28 bg-[var(--color-border-light)] rounded-2xl" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4 opacity-40">📖</div>
            <p className="text-sm text-[var(--color-text-disabled)]">
              {search || dateStart || dateEnd ? '没有匹配的日记' : '还没有日记'}
            </p>
          </div>
        ) : (
          /* ===== 时间轴 ===== */
          <div className="space-y-8">
            {dateGroups.map(([date, items]) => (
              <div key={date} className="relative">
                {/* 时间线竖线 */}
                <div className="tl-line" style={{ left: 21 }} />

                {/* 日期头 */}
                <div className="relative flex items-center gap-3 mb-3" style={{ marginLeft: 54 }}>
                  <div className="tl-dot" style={{ position: 'absolute', left: -39, top: '50%', marginTop: -7 }} />
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">{formatJournalDate(items[0].created)}</span>
                    <span className="text-[11px] text-[var(--color-text-disabled)]">{items.length} 篇</span>
                  </div>
                </div>

                {/* 日记卡片 */}
                <div className="space-y-3" style={{ marginLeft: 54 }}>
                  {items.map(e => {
                    const s = stats(e.content ?? '')
                    return (
                      <div key={e.id} className="tl-card p-4" onClick={() => openDetail(e)}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${authorColor(e.author)}`}>
                              {e.author}
                            </span>
                            <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{e.name}</span>
                            {e.locked && <span className="text-xs flex-shrink-0 opacity-60">🔒</span>}
                          </div>
                          <span className="text-[11px] text-[#B0A590] font-mono flex-shrink-0 whitespace-nowrap">{s.chars}字·~{s.tokens}tok</span>
                        </div>
                        {e.locked ? (
                          <p className="text-sm text-[var(--color-text-disabled)] italic leading-relaxed">
                            已上锁{e.unlock_hint ? ` · ${e.unlock_hint}` : ''}
                          </p>
                        ) : (
                          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap line-clamp-3">
                            {e.content}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 详情弹窗 ===== */}
      {detail && (
        <DetailPanel open={true} onClose={closeDetail} mode="modal" width="max-w-2xl">

            {detailFetching ? (
              <div className="flex items-center justify-center py-20 text-sm text-[var(--color-text-disabled)]">读取中...</div>
            ) : (
              <>
                {/* 头部 */}
                <div className="px-6 pt-6 pb-4 border-b border-[var(--color-border-light)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">{detail.entry.name}</h2>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--color-text-tertiary)]">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${authorColor(detail.entry.author)}`}>
                          {detail.entry.author}
                        </span>
                        <span>日记: {formatBeijingDate(detail.entry.created)}</span>
                        <span>创建: {formatBeijingDateTime(detail.entry.created)}</span>
                        {detail.meta?.last_active && detail.meta.last_active !== detail.entry.created && (
                          <span>修改: {formatBeijingDateTime(detail.meta.last_active)}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={closeDetail}
                      className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] p-1.5 bg-[var(--color-surface-secondary)] rounded-full flex-shrink-0 transition-colors text-sm leading-none">✕</button>
                  </div>
                </div>

                {/* 内容区 */}
                <div className="px-6 py-4 flex-1 overflow-y-auto custom-scroll" style={{ minHeight: 0 }}>
                  {detail.entry.locked && detail.fullContent === (detail.entry.content ?? '') ? (
                    <p className="text-sm text-[var(--color-text-disabled)] italic py-6 text-center">
                      已上锁{detail.entry.unlock_hint ? ` · 提示：${detail.entry.unlock_hint}` : ''}
                    </p>
                  ) : !editing ? (
                    <div className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">{detail.fullContent}</div>
                  ) : (
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="w-full text-sm leading-relaxed resize-none outline-none border border-[var(--color-primary)] rounded-xl p-4 min-h-[200px]"
                      style={{ background: 'var(--color-surface-elevated)' }}
                      rows={14}
                    />
                  )}
                </div>

                {/* 底部操作区 */}
                <div className="px-6 py-4 border-t border-[var(--color-border-light)]">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="text-[11px] text-[#B0A590] font-mono">
                      {stats(detail.fullContent).chars} 字 · ~{stats(detail.fullContent).tokens} tokens
                    </div>
                    <div className="flex items-center gap-3">
                      {!editing ? (
                        <button onClick={() => { setEditing(true); setEditContent(detail.fullContent) }}
                          className="text-xs font-medium px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] transition-colors">
                          编辑
                        </button>
                      ) : (
                        <>
                          <button onClick={() => setEditing(false)}
                            className="text-xs px-3 py-1.5 rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors">
                            取消
                          </button>
                          <button onClick={saveEdit} disabled={saving}
                            className="text-xs text-white px-4 py-1.5 rounded-full disabled:opacity-50 transition-all"
                            style={{ background: 'linear-gradient(135deg, #E8A58F, var(--color-primary))' }}>
                            {saving ? '保存中…' : '保存更改'}
                          </button>
                        </>
                      )}
                      <button onClick={deleteJournal}
                        className="text-xs font-medium text-[var(--color-danger)] hover:text-red-700 transition-colors">
                        抹除
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[11px] text-[var(--color-text-disabled)] font-mono">bucket_id: {detail.entry.id}</span>
                    <button onClick={copyId}
                      className="text-[11px] text-[var(--color-primary)] hover:underline flex-shrink-0">
                      {copied ? '已复制' : '复制'}
                    </button>
                  </div>
                </div>
              </>
            )}
        </DetailPanel>
      )}

      {/* ===== 写新日记弹窗 ===== */}
      <DetailPanel open={showAdd} onClose={() => setShowAdd(false)} mode="modal" width="max-w-lg">
        <h3 className="text-[var(--color-text-primary)] font-semibold mb-4">写新日记</h3>

            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="标题（可选，留空自动生成）"
              className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm mb-3 outline-none focus:border-[var(--color-primary)] transition-colors" />

            <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
              placeholder="写点什么…"
              rows={8}
              className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm mb-3 outline-none focus:border-[var(--color-primary)] transition-colors resize-none leading-relaxed" />

            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div className="flex items-center gap-2">
                {(['言之', '小羊', '共同'] as Author[]).map(a => (
                  <button key={a} onClick={() => setNewAuthor(a)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                      newAuthor === a ? authorColor(a) : 'bg-white border border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]'
                    }`}>
                    {a}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer select-none">
                <input type="checkbox" checked={newLocked} onChange={e => setNewLocked(e.target.checked)}
                  className="accent-[var(--color-primary)]" />
                上锁
              </label>
            </div>

            {newLocked && (
              <input value={newUnlockHint} onChange={e => setNewUnlockHint(e.target.value)}
                placeholder="解锁提示（日期如 2026-07-01 到点自动解锁，其他文本保持锁定当提示用）"
                className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-xs mb-3 outline-none focus:border-[var(--color-primary)] transition-colors" />
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setShowAdd(false)}
                className="text-sm px-4 py-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors">
                取消
              </button>
              <button onClick={submitNew} disabled={submitting || !newContent.trim()}
                className="text-sm text-white px-5 py-2 rounded-full disabled:opacity-50 transition-all hover:shadow-md"
                style={{ background: 'linear-gradient(135deg, #E8A58F, var(--color-primary))' }}>
                {submitting ? '保存中…' : '保存日记'}
              </button>
            </div>
        </DetailPanel>

      {/* 悬浮加号 */}
      <button onClick={() => { setShowAdd(true); resetNewForm() }}
        className="fixed bottom-28 md:bottom-8 right-4 sm:right-8 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[var(--color-primary)] text-white text-xl sm:text-2xl shadow-lg hover:bg-[var(--color-primary-hover)] transition-colors flex items-center justify-center z-50">
        +
      </button>
    </div>
  )
}
