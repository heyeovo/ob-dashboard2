'use client'
import type { CcPersona } from './persona'

// 协作者侧边栏（对话列表**左上角**点开的那个）。只做三件事：看列表 / 切换 / 新建。
//
// ⚠️ 别把这里和右上角的设置界面混了 —— 一句话记法：左边选人，右边配这个人。
// 群聊以后也在这儿，但**现在不做**：cc 引擎一个会话就是一个 claude code 子进程，
// 没有「多协作者轮流说话」的概念。

type Props = {
  personas: CcPersona[]
  activeId: string
  loading: boolean
  onPick: (id: string) => void
  onNew: () => void
  onClose: () => void
}

const ENGINE_LABEL: Record<string, string> = {
  subscription: '订阅',
  api: '中转站',
  selfhost: '自建',
}

export default function CcPersonaRail({
  personas,
  activeId,
  loading,
  onPick,
  onNew,
  onClose,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="text-xs font-medium text-[var(--color-text-tertiary)]">协作者</span>
        <button
          type="button"
          onClick={onNew}
          className="ml-auto rounded-full bg-[var(--color-primary-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-primary)] transition-colors hover:bg-[#FBE5DE]"
        >
          新建
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起协作者列表"
          className="rounded-[var(--radius-md)] px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-secondary)]"
        >
          收起
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {loading && personas.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">加载中</div>
        ) : personas.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[var(--color-text-disabled)]">
            读不到协作者配置
            <div className="mt-1 leading-relaxed">
              Haven 没连上时聊天仍可用，走内置的 Ombre
            </div>
          </div>
        ) : (
          personas.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className={`cc-rail-item mb-0.5 flex w-full items-center gap-2.5 px-2.5 py-2 text-left ${
                p.id === activeId ? 'active' : ''
              }`}
            >
              <span className="cc-avatar" style={{ background: p.tint }} aria-hidden="true">
                {p.initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-[var(--color-text-primary)]">
                  {p.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-disabled)]">
                  {p.description || ENGINE_LABEL[p.engine] || p.engine}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      <p className="border-t border-[var(--color-border-light)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
        每个协作者有自己的一套对话。换人会开一个新对话，原来那个留在上一个人名下。
      </p>
    </div>
  )
}
