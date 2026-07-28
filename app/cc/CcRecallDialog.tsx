'use client'
import { useEffect } from 'react'
import type { CcMessage, CcRecallModule } from './types'

// 这一轮动态召回的详情，按模块分段。
//
// 正文来自服务端：/api/cc-chat 把 Haven 的 additional_context 按标签切成 modules[]，
// 既走 recall 事件（当轮显示），也存进 conversation_turns 的 raw_json（历史读回）。
// 纯前端，不用改 Haven。切不出内容时退回按统计合成的空态。

/** Haven 那边的模块名 → 界面上的段标题和说明。
 *  只列真正走「动态召回」这条路的两类；换窗（handoff / cross_window）不是召回，不在这。 */
const MODULE_META: Record<string, { title: string; hint: string }> = {
  memory_card: { title: '记忆桶', hint: 'BM25 + 语义检索命中的记忆卡片' },
  date_recall: { title: '日期召回', hint: '「昨天/前天/某月某日」捞出的当天对话原文' },
}

function metaOf(key: string) {
  return MODULE_META[key] || { title: key, hint: '' }
}

export default function CcRecallDialog({
  message,
  onClose,
}: {
  message: CcMessage
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const recall = message.recall
  const modules: CcRecallModule[] = recall?.modules?.length
    ? recall.modules
    : // 没有模块明细时，按已知的统计合成一段，别让弹窗空着
      [
        {
          key: 'memory_card',
          card_count: recall?.card_count ?? 0,
          chars: recall?.chars ?? 0,
          text: '',
        },
      ]

  return (
    <div className="cc-modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0" />
      <div className="cc-modal relative flex max-h-[82vh] w-full max-w-xl flex-col">
        <div className="flex items-center gap-3 border-b border-[var(--color-border-light)] px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--color-text-heading)]">
              这一轮的动态召回
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">
              共 {recall?.card_count ?? 0} 条 / {recall?.chars ?? 0} 字 · {recall?.elapsed_ms ?? 0} ms
              {recall?.injected ? '' : ' · 未注入'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            关闭
          </button>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {recall?.domains?.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {recall.domains.map(d => (
                <span key={d} className="cc-recall-tag">
                  {d}
                </span>
              ))}
            </div>
          ) : null}

          {modules.map(mod => {
            const meta = metaOf(mod.key)
            return (
              <section key={mod.key} className="cc-recall-section">
                <div className="flex items-baseline gap-2">
                  <span className="cc-modal-label">{meta.title}</span>
                  <span className="text-[11px] text-[var(--color-text-disabled)]">
                    {mod.card_count ? `${mod.card_count} 条 · ` : ''}
                    {mod.chars} 字
                  </span>
                </div>
                {meta.hint ? (
                  <div className="mt-0.5 text-[11px] text-[var(--color-text-disabled)]">{meta.hint}</div>
                ) : null}
                {mod.text ? (
                  <pre className="cc-modal-pre">{mod.text}</pre>
                ) : (
                  <div className="cc-recall-empty">
                    {mod.chars > 0 ? '有内容，但正文没回传' : '这一轮没有内容'}
                  </div>
                )}
              </section>
            )
          })}

          {recall?.error ? (
            <div className="mt-4 text-[11px] text-[var(--color-danger)]">{recall.error}</div>
          ) : null}

          <p className="mt-5 border-t border-[var(--color-border-light)] pt-3 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
            这里是这一轮真正注入模型的记忆正文，按类型分段。
            出现「召回时好时坏」时，靠这里看是哪一句、哪一段召回了什么、有没有出内容。
          </p>
        </div>
      </div>
    </div>
  )
}
