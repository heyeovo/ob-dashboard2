'use client'
import { useState } from 'react'
import { formatBeijingDateTime } from '@/app/utils/format'

// ==================== 类型定义 ====================
interface BucketDetail {
  id: string
  content: string
  score: number
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
}: Props) {
  // 内部缓存 importance 输入值
  const [localImp, setLocalImp] = useState<number | null>(null)

  return (
    <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${selected || detailLoading ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className="absolute inset-0 bg-[#3A3836]/20 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`absolute right-0 top-0 h-full w-full sm:max-w-2xl bg-white shadow-2xl transition-transform duration-300 transform ${selected || detailLoading ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}
      >
        {detailLoading ? (
          <div className="flex items-center justify-center h-full text-[#A8A49D]">读取中...</div>
        ) : selected ? (
          <div className="p-6 sm:p-8 overflow-y-auto h-full">
            {/* 头部 */}
            <div className="flex items-start justify-between mb-6 pb-4 border-b border-[#F0EFEB]">
              <div className="pr-4">
                <div className="flex items-center gap-2 mb-1">
                  {selected.metadata.pinned && <span className="text-[#D97757] text-lg">★</span>}
                  <h2 className="text-xl sm:text-2xl font-bold text-[#2B2927]">{selected.metadata.name}</h2>
                </div>
                <div className="text-xs text-[#8A8681] truncate mt-2">
                  创建: {formatBeijingDateTime(selected.metadata.created)} · 修改: {formatBeijingDateTime(selected.metadata.last_active)}
                </div>
              </div>
              <button onClick={onClose} className="text-[#A8A49D] hover:text-[#3A3836] p-1.5 bg-[#F9F8F6] rounded-full">✕</button>
            </div>

            {/* 信息胶囊 */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
                <div className="text-[10px] text-[#8A8681] mb-0.5">IMP</div>
                <input
                  type="number" min="0" max="10"
                  className="w-full text-sm font-bold text-[#D97757] outline-none text-center bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  defaultValue={selected.metadata.importance ?? ''}
                  disabled={operating}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (isNaN(val) || val === selected.metadata.importance) return
                    if (onImportanceChange) onImportanceChange(selected.id, val)
                  }}
                />
              </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[#8A8681] mb-0.5">权重</div>
                  <div className="text-sm font-semibold text-[#3A3836]">{selected.score?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[#8A8681] mb-0.5">激活</div>
                  <div className="text-sm font-semibold text-[#3A3836]">{selected.metadata.activation_count ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[#8A8681] mb-0.5">效价 V</div>
                  <div className="text-sm font-semibold text-[#3A3836]">{selected.metadata.valence?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[#8A8681] mb-0.5">唤醒 A</div>
                  <div className="text-sm font-semibold text-[#3A3836]">{selected.metadata.arousal?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white/60 backdrop-blur-sm border border-[#E8E6E1] shadow-sm rounded-lg px-2 py-2 text-center">
                  <div className="text-[10px] text-[#8A8681] mb-0.5">类型</div>
                  <div className="text-sm font-semibold text-[#3A3836]">
                    {{ dynamic: '动态', permanent: '永久', feel: 'feel', archived: '已归档' }[selected.metadata.type] ?? selected.metadata.type ?? '—'}
                  </div>
                </div>
              </div>

            {/* 标签 */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {(selected.metadata.domain ?? []).map(d => (
                <span key={d} className="text-xs bg-[#EFECE6] px-2.5 py-1 rounded-md text-[#5B5854]">{d}</span>
              ))}
              {(selected.metadata.tags ?? []).map(t => (
                <span key={t} className="text-xs border border-[#E8E6E1] px-2.5 py-1 rounded-md text-[#6C6965]">{t}</span>
              ))}
            </div>

            {/* 操作按钮组 */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { pinned: selected.metadata.pinned ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.pinned ? 'bg-[#FDF0ED] text-[#D97757]' : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                }`}>
                {selected.metadata.pinned ? '已钉选' : '钉 选'}
              </button>
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { digested: selected.metadata.digested ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.digested ? 'bg-[#EDF4FC] text-[#3B72B9]' : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                }`}>
                {selected.metadata.digested ? '已消化' : '消 化'}
              </button>
              <button disabled={operating}
                onClick={() => onTraceOp(selected.id, { resolved: selected.metadata.resolved ? 0 : 1 })}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.resolved
                    ? 'bg-[#EDF4FC] text-[#3B72B9]'
                    : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                }`}>
                {selected.metadata.resolved ? '已解决' : '解 决'}
              </button>
              <button disabled={operating}
                onClick={() => onArchive(selected.id)}
                className={`text-xs py-2 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  selected.metadata.type === 'archived' ? 'bg-[#F4F2EC] text-[#8A8681]' : 'bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6]'
                }`}>
                {selected.metadata.type === 'archived' ? '已归档' : '归 档'}
              </button>
              <button disabled={operating}
                onClick={() => onTouch(selected.id)}
                className="text-xs py-2 rounded-lg font-medium bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] transition-colors disabled:opacity-50">
                轻 触
              </button>
              <button disabled={operating}
                onClick={() => onActivate(selected.id)}
                className="text-xs py-2 rounded-lg font-medium bg-white border border-[#E8E6E1] text-[#6C6965] hover:bg-[#F9F8F6] transition-colors disabled:opacity-50">
                激 活
              </button>
            </div>

            {/* 内容区 */}
            {!editing ? (
              <div className="bg-[#FDFCFB] border border-[#F0EFEB] rounded-xl overflow-hidden mb-4">
                <div className="flex justify-between items-center px-5 pt-3 pb-2 border-b border-[#F0EFEB]">
                  <span className="text-xs font-medium text-[#A8A49D] uppercase tracking-wider">内容</span>
                  <button onClick={() => onStartEdit(selected.content)} className="text-xs text-[#D97757] font-medium hover:text-[#B65D40]">编辑</button>
                </div>
                <div className="p-5 text-sm leading-loose whitespace-pre-wrap">
                  {selected.content}
                </div>
              </div>
            ) : (
              <div className="bg-[#FDFCFB] border border-[#D97757] rounded-xl p-4 mb-4">
                <textarea
                  className="w-full bg-transparent text-sm leading-relaxed resize-none outline-none"
                  rows={14}
                  value={editContent}
                  onChange={e => onStartEdit(e.target.value)}
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={onCancelEdit} className="text-sm text-[#8A8681] hover:text-[#3A3836]">取消</button>
                  <button onClick={onSaveEdit} disabled={saving}
                    className="text-sm bg-[#D97757] text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{saving ? '保存中' : '保存更改'}</button>
                </div>
              </div>
            )}

            {/* 抹除和索引 */}
            <div className="flex justify-between items-center">
              <button onClick={() => { if (confirm('确定抹除此记忆？不可恢复。')) { onTraceOp(selected.id, { delete: true }).then(onClose) } }}
                className="text-sm text-[#C64B45] font-medium hover:text-red-700">抹除</button>
              <div onClick={onCopyId} className="inline-flex items-center gap-2 text-xs cursor-pointer hover:bg-[#F0EFEB] px-3 py-1.5 rounded-full">
                <span className="text-[#A8A49D]">索引: {selected.id}</span>
                <span className={`${copied ? 'text-[#D97757]' : 'text-[#A8A49D]'}`}>{copied ? '已复制' : '复制'}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
