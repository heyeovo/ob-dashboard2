'use client'
import { useEffect, useState } from 'react'
import { MODE_HINT, MODE_LABEL, type CcMode } from '@/app/lib/ccModes'

export type HandoffPayload = {
  mode: CcMode
  includeDailyReview: boolean
  bucketIds: string[]
  turns: number
  fromSessionId: string | null
}

type BucketItem = {
  id: string
  title: string
  pinned: boolean
}

type Props = {
  /** null = 从 "+" 新建进来（不带对话原文）；有值 = 从换窗按钮进来 */
  fromSessionId: string | null
  currentMode: CcMode
  onConfirm: (payload: HandoffPayload) => void
  onClose: () => void
}

export default function CcHandoffDialog({ fromSessionId, currentMode, onConfirm, onClose }: Props) {
  const [mode, setMode] = useState<CcMode>(currentMode)
  // 钉选桶固定带（默认勾上），另加最近 10 个非钉选桶。两组分开显示。
  const [pinnedBuckets, setPinnedBuckets] = useState<BucketItem[]>([])
  const [recentBuckets, setRecentBuckets] = useState<BucketItem[]>([])
  const [bucketsLoading, setBucketsLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [turns, setTurns] = useState(20)
  const [includeDailyReview, setIncludeDailyReview] = useState(true)

  useEffect(() => {
    let cancelled = false
    setBucketsLoading(true)
    // 拉多一点：钉选桶可能排在时间序 10 名之外，limit=10 会漏掉
    fetch('/api/buckets?limit=40')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const all: BucketItem[] = (data.buckets || data || []).map((b: any) => ({
          id: b.id,
          title: b.name || b.title || b.id,
          pinned: !!b.pinned,
        }))
        const pinned = all.filter(b => b.pinned)
        // 非钉选取时间倒序前 10（后端已按时间倒序返回）
        const recent = all.filter(b => !b.pinned).slice(0, 10)
        setPinnedBuckets(pinned)
        setRecentBuckets(recent)
        // 钉选桶默认勾选 —— 「固定会带」
        setSelected(new Set(pinned.map(b => b.id)))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBucketsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const allBuckets = [...pinnedBuckets, ...recentBuckets]
  const bucketGroups = [
    { label: '已钉选（固定带上）', items: pinnedBuckets },
    { label: '最近记忆', items: recentBuckets },
  ]

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === allBuckets.length) setSelected(new Set())
    else setSelected(new Set(allBuckets.map(b => b.id)))
  }

  const handleConfirm = () => {
    onConfirm({
      mode,
      includeDailyReview,
      bucketIds: [...selected],
      turns: fromSessionId ? turns : 0,
      fromSessionId,
    })
  }

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      <div
        className="cc-modal relative flex max-h-[86vh] w-full max-w-sm flex-col"
        role="dialog"
        aria-label="新对话"
      >
        {/* 头 */}
        <div className="flex items-center justify-between border-b border-[var(--color-border-light)] px-5 py-3.5">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-heading)]">
              {fromSessionId ? '换窗' : '新对话'}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">
              {fromSessionId ? '带上下文开新窗口' : '选模式，可选带记忆'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            取消
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {/* ── 模式选择 ── */}
          <div className="mb-1.5 text-[11px] text-[var(--color-text-disabled)]">模式</div>
          <div className="mb-4 flex gap-2.5">
            {(['chat', 'work'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-[var(--radius-lg)] border px-3.5 py-2.5 text-left transition-colors ${
                  mode === m
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/40'
                }`}
              >
                <span className="block text-[12px] font-medium text-[var(--color-text-heading)]">
                  {MODE_LABEL[m]}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-[var(--color-text-tertiary)]">
                  {MODE_HINT[m]}
                </span>
              </button>
            ))}
          </div>

          <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={includeDailyReview}
              onChange={event => setIncludeDailyReview(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            <span>
              <span className="block text-[11.5px] text-[var(--color-text-secondary)]">注入最近三天日回顾</span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--color-text-disabled)]">
                创建窗口时冻结为快照，之后不会随日期变化
              </span>
            </span>
          </label>

          {/* ── 记忆桶 ── */}
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-text-disabled)]">带记忆桶</span>
            {allBuckets.length > 0 && (
              <button
                type="button"
                onClick={selectAll}
                className="text-[10.5px] text-[var(--color-primary)] hover:underline"
              >
                {selected.size === allBuckets.length ? '全不选' : '全选'}
              </button>
            )}
          </div>
          {bucketsLoading ? (
            <div className="py-4 text-center text-[11px] text-[var(--color-text-disabled)]">加载中</div>
          ) : allBuckets.length === 0 ? (
            <div className="py-4 text-center text-[11px] text-[var(--color-text-disabled)]">暂无记忆桶</div>
          ) : (
            <div className="mb-4 space-y-3">
              {bucketGroups.map(g =>
                g.items.length === 0 ? null : (
                  <div key={g.label}>
                    <div className="mb-1 px-0.5 text-[10px] font-medium text-[var(--color-text-disabled)]">
                      {g.label}
                    </div>
                    <div className="space-y-1">
                      {g.items.map(b => (
                        <label
                          key={b.id}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 transition-colors ${
                            selected.has(b.id)
                              ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary-muted)]'
                              : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(b.id)}
                            onChange={() => toggle(b.id)}
                            className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                          />
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-text-secondary)]">
                            {b.title}
                          </span>
                          {b.pinned && (
                            <span className="shrink-0 text-[9.5px] text-[var(--color-pinned)]">已钉选</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {/* ── 对话原文轮次（只有换窗模式显示） ── */}
          {fromSessionId && (
            <>
              <div className="mb-1.5 text-[11px] text-[var(--color-text-disabled)]">
                带上个窗口最近对话
              </div>
              <div className="mb-1 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={turns}
                  onChange={e => setTurns(Number(e.target.value))}
                  className="h-1 flex-1 accent-[var(--color-primary)]"
                />
                <span className="w-12 text-right text-[12px] tabular-nums text-[var(--color-text-secondary)]">
                  {turns} 轮
                </span>
              </div>
              <div className="mb-4 text-[10.5px] text-[var(--color-text-disabled)]">
                {turns === 0 ? '不带对话原文' : '会以淡色背景显示在新窗口顶部'}
              </div>
            </>
          )}
        </div>

        {/* 底部确认 */}
        <div className="border-t border-[var(--color-border-light)] px-5 py-3.5">
          <button
            type="button"
            onClick={handleConfirm}
            className="w-full rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {fromSessionId ? '换窗开始' : '开始新对话'}
          </button>
        </div>
      </div>
    </div>
  )
}
