'use client'
import { useEffect, useState } from 'react'
import type { CcPermRequest } from './types'

// 对话流里那张「要批准吗」的卡片（第 5 步）。
//
// 这一轮**正停在服务端**等这里点按钮 —— 不点它就一直挂着（30 分钟后自动按拒绝收场）。
// 所以卡片上必须说清三件事：改哪个文件、具体改什么（diff）、还剩多久。
//
// ⚠️「本会话都放行」只对 Edit / Write 出现。Bash 每一条都要点，用户拍板的：
// 命令能干的事没有边界（rm、git push、装东西），没法靠「这次批了下次也算」。

const KIND_LABEL: Record<string, string> = {
  edit: '改文件',
  write: '写文件',
  bash: '跑命令',
  other: '操作',
}

function remainText(expiresAt: number, now: number): string {
  const left = expiresAt - now
  if (left <= 0) return '已超时'
  const min = Math.floor(left / 60_000)
  if (min >= 1) return `还剩 ${min} 分钟`
  return `还剩 ${Math.max(1, Math.floor(left / 1000))} 秒`
}

export function CcPermCard({
  request,
  onAnswer,
}: {
  request: CcPermRequest
  onAnswer: (id: string, allow: boolean, opts?: { remember?: boolean }) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  // 每 10 秒刷一下倒计时。挂着的东西必须让人看出来它在走
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])

  const isWriteTool = request.kind === 'edit' || request.kind === 'write'
  const diff = request.diff

  const answer = (allow: boolean, remember = false) => {
    if (busy) return
    setBusy(true)
    onAnswer(request.id, allow, { remember })
  }

  return (
    <div className="cc-perm-card">
      <div className="cc-perm-head">
        <span className={`cc-perm-kind${request.kind === 'bash' ? ' bash' : ''}`}>
          {KIND_LABEL[request.kind] || '操作'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="cc-perm-title">{request.title}</div>
          {request.filePath ? <div className="cc-perm-path">{request.filePath}</div> : null}
          {request.description ? (
            <div className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
              {request.description}
            </div>
          ) : null}
        </div>
      </div>

      {/* 命令：原文照抄，不做任何美化 —— 要批的就是这一行字 */}
      {request.kind === 'bash' && request.command ? (
        <div className="cc-perm-body">{request.command}</div>
      ) : null}

      {/* 改文件：行级 diff */}
      {diff ? (
        <div className="cc-perm-body">
          {diff.note ? (
            <div className="mb-1.5 text-[10.5px] text-[var(--color-text-disabled)]">{diff.note}</div>
          ) : null}
          {diff.lines.map((line, i) => (
            <div
              key={i}
              className={`cc-diff-line${
                line.tag === '+' ? ' add' : line.tag === '-' ? ' del' : line.n ? '' : ' gap'
              }`}
            >
              <span className="cc-diff-n">{line.n ?? ''}</span>
              <span>{line.tag === ' ' ? line.text : `${line.tag} ${line.text}`}</span>
            </div>
          ))}
          {diff.truncated ? (
            <div className="mt-1.5 text-[10.5px] text-[var(--color-text-disabled)]">
              改动太长，这里只显示前面一段
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="cc-perm-foot">
        <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => answer(true)}>
          批准
        </button>
        <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => answer(false)}>
          拒绝
        </button>
        {isWriteTool ? (
          <button
            type="button"
            className="cc-btn-ghost"
            disabled={busy}
            onClick={() => answer(true, true)}
            title="之后改文件不再一条条问。跑命令不受影响，永远都会问"
          >
            本次对话都放行
          </button>
        ) : null}
        <span className="cc-perm-expire">{remainText(request.expiresAt, now)}</span>
      </div>
    </div>
  )
}
