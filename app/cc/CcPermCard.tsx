'use client'
import { useEffect, useState } from 'react'
import type { CcPermRequest } from './types'

// 对话流里那张「要批准吗」的卡片（第 5 步）。
//
// 这一轮**正停在服务端**等这里点按钮 —— 不点它就一直挂着（30 分钟后自动按拒绝收场）。
// 所以卡片上必须说清三件事：改哪个文件、具体改什么（diff）、还剩多久。
//
// Edit / Write 沿用原有的本会话开关；Bash / WebFetch 只按 SDK 给出的细粒度规则
// 显示会话级 / 永久批准，不放开整个工具。

const KIND_LABEL: Record<string, string> = {
  edit: '改文件',
  write: '写文件',
  bash: '跑命令',
  web: '访问网页',
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
  onAnswer: (
    id: string,
    allow: boolean,
    opts?: { remember?: boolean; scope?: 'once' | 'session' | 'always' },
  ) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  // 每 10 秒刷一下倒计时。挂着的东西必须让人看出来它在走
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])

  const isWriteTool = request.kind === 'edit' || request.kind === 'write'
  const reusableRules = (request.suggestions || []).flatMap(update =>
    update.type === 'addRules' && update.behavior === 'allow'
      ? (update.rules || []).filter(rule => {
          const content = String(rule.ruleContent || '').trim()
          return (
            (rule.toolName === 'Bash' && !!content) ||
            (rule.toolName === 'WebFetch' && content.startsWith('domain:'))
          )
        })
      : [],
  )
  const hasReusableRule =
    reusableRules.length > 0 && (request.kind === 'bash' || request.kind === 'web')
  const ruleLabel = reusableRules
    .map(rule =>
      rule.toolName === 'WebFetch'
        ? `网页域名：${String(rule.ruleContent || '').replace(/^domain:/, '')}`
        : `命令范围：${rule.ruleContent || ''}`,
    )
    .join('；')
  const diff = request.diff

  const answer = (
    allow: boolean,
    opts: { remember?: boolean; scope?: 'once' | 'session' | 'always' } = {},
  ) => {
    if (busy) return
    setBusy(true)
    onAnswer(request.id, allow, opts)
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

      {hasReusableRule ? (
        <div className="mt-2 rounded-lg bg-[var(--color-surface-secondary)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
          {ruleLabel}
        </div>
      ) : null}

      <div className="cc-perm-foot">
        <button
          type="button"
          className="cc-btn-primary"
          disabled={busy}
          onClick={() => answer(true, { scope: 'once' })}
        >
          仅这次批准
        </button>
        <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => answer(false)}>
          拒绝
        </button>
        {isWriteTool ? (
          <button
            type="button"
            className="cc-btn-ghost"
            disabled={busy}
            onClick={() => answer(true, { remember: true, scope: 'session' })}
            title="之后改文件不再一条条问；Bash 和网页权限仍按各自规则处理"
          >
            本次对话都放行
          </button>
        ) : null}
        {hasReusableRule ? (
          <>
            <button
              type="button"
              className="cc-btn-ghost"
              disabled={busy}
              onClick={() => answer(true, { scope: 'session' })}
              title={ruleLabel}
            >
              本次对话允许
            </button>
            <button
              type="button"
              className="cc-btn-ghost"
              disabled={busy}
              onClick={() => answer(true, { scope: 'always' })}
              title={`${ruleLabel}。永久保存到 Haven，可在后续会话继续生效。`}
            >
              始终允许
            </button>
          </>
        ) : null}
        <span className="cc-perm-expire">{remainText(request.expiresAt, now)}</span>
      </div>
    </div>
  )
}
