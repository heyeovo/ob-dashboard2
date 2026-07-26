'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CcPermCard } from '../cc/CcPermCard'
import { ACTIVE_SESSION_KEY } from '../cc/useCcChat'
import { EMPTY_WORKBENCH, type CcWorkbench } from '../cc/types'

// 工作台四格的内容（第 5 步）。
//
// 四个「现在」的问题：有什么等我批准 / 这次改了哪些文件 / 能退回到哪 / 命令输出是什么。
// 全部是**当前会话**范围 —— 换会话就换一套。
//
// ⚠️ 回退（rewindFiles）只在子进程还活着时有效：文件备份存在那个进程里，
// 闲置 10 分钟被回收后就没了。所以 live=false 时那一格照实说「用 git」，不给假按钮。

function short(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}

function timeText(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function CcWorkbenchPanel() {
  const [sessionId, setSessionId] = useState('')
  const [data, setData] = useState<CcWorkbench>(EMPTY_WORKBENCH)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rewinding, setRewinding] = useState('')
  const [rewindNote, setRewindNote] = useState('')

  useEffect(() => {
    try {
      setSessionId(window.localStorage.getItem(ACTIVE_SESSION_KEY) || '')
    } catch {
      setSessionId('')
    }
    setLoading(false)
  }, [])

  const refresh = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/cc-workbench?session_id=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      const payload = await res.json()
      if (payload.ok) {
        setData(payload as CcWorkbench)
        setError('')
      } else {
        setError(String(payload.error || '读不到工作台状态'))
      }
    } catch (e) {
      setError((e as Error).message || '读不到工作台状态')
    }
  }, [sessionId])

  // 5 秒一次。这一页就是看「现在」的，慢了就没意义
  useEffect(() => {
    if (!sessionId) return
    void refresh()
    const timer = setInterval(refresh, 5_000)
    return () => clearInterval(timer)
  }, [sessionId, refresh])

  const answer = useCallback(
    async (id: string, allow: boolean, opts?: { remember?: boolean }) => {
      setData(prev => ({ ...prev, pending: prev.pending.filter(p => p.id !== id) }))
      try {
        await fetch('/api/cc-permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            id,
            decision: allow ? 'allow' : 'deny',
            remember: opts?.remember === true,
          }),
        })
      } catch {
        /* 下面 refresh 会把真实状态拉回来 */
      }
      void refresh()
    },
    [sessionId, refresh],
  )

  const rewind = useCallback(
    async (uuid: string, dryRun: boolean) => {
      setRewinding(uuid)
      setRewindNote('')
      try {
        const res = await fetch('/api/cc-workbench', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, uuid, dry_run: dryRun }),
        })
        const payload = await res.json()
        if (!payload.ok) {
          setRewindNote(String(payload.error || '回退失败'))
        } else {
          const files = (payload.files_changed || []) as string[]
          setRewindNote(
            dryRun
              ? files.length
                ? `会还原 ${files.length} 个文件：${files.map(short).join('、')}`
                : '这个点之后没有文件改动，不用回退'
              : `已还原 ${files.length} 个文件（+${payload.insertions} / -${payload.deletions}）`,
          )
        }
      } catch (e) {
        setRewindNote((e as Error).message || '回退失败')
      } finally {
        setRewinding('')
        void refresh()
      }
    },
    [sessionId, refresh],
  )

  if (loading) return <div className="cc-wb-empty px-1 py-6">读取中</div>

  if (!sessionId) {
    return (
      <div className="cc-wb-card">
        <div className="cc-wb-body">
          <p className="cc-wb-empty">
            还不知道你在聊哪个会话。先去{' '}
            <Link href="/cc" className="underline">
              聊天页
            </Link>{' '}
            说一句话，这四格就跟着那个会话走。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
        <span className="font-mono">{sessionId}</span>
        <span
          className={`cc-wb-count${data.live ? ' hot' : ''}`}
          title={data.live ? '子进程活着，回退可用' : '子进程已回收，回退不可用'}
        >
          {data.live ? '会话活着' : '会话已休眠'}
        </span>
        <Link href="/cc" className="ml-auto underline">
          回聊天页 →
        </Link>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] bg-[#FCEEED] px-3 py-2 text-[11px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ① 待批准 */}
        <div className="cc-wb-card lg:col-span-2">
          <div className="cc-wb-head">
            <span className="cc-wb-title">待批准的操作</span>
            <span className={`cc-wb-count${data.pending.length ? ' hot' : ''}`}>
              {data.pending.length}
            </span>
            {data.auto_allow_edits ? (
              <span className="ml-auto text-[10.5px] text-[var(--color-text-tertiary)]">
                改文件已放行（跑命令仍每次问）
              </span>
            ) : null}
          </div>
          <div className="cc-wb-body space-y-3">
            {data.pending.length === 0 ? (
              <p className="cc-wb-empty">
                没有等着的。模型要改文件或跑命令时，请求会出现在这里，也会出现在聊天页那一轮下面 ——
                两处点哪边都一样，那一轮正停在服务端等。
              </p>
            ) : (
              data.pending.map(req => <CcPermCard key={req.id} request={req} onAnswer={answer} />)
            )}
            {data.decided.length ? (
              <div className="pt-1">
                <div className="cc-modal-label mb-1">刚才决定过的</div>
                {data.decided.slice(0, 6).map(d => (
                  <div key={d.id} className="cc-wb-row">
                    <span
                      className={
                        d.outcome === 'allow' ? 'cc-wb-add' : 'text-[var(--color-text-tertiary)]'
                      }
                    >
                      {d.outcome === 'allow'
                        ? '批准'
                        : d.outcome === 'deny'
                          ? '拒绝'
                          : d.outcome === 'expired'
                            ? '超时'
                            : '取消'}
                    </span>
                    <span className="cc-wb-path">{d.filePath ? short(d.filePath) : d.command || d.toolName}</span>
                    <span className="cc-wb-delta text-[var(--color-text-disabled)]">{timeText(d.at)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* ② 改过的文件 */}
        <div className="cc-wb-card">
          <div className="cc-wb-head">
            <span className="cc-wb-title">这次会话改过的文件</span>
            <span className="cc-wb-count">{data.files.length}</span>
          </div>
          <div className="cc-wb-body">
            {data.files.length === 0 ? (
              <p className="cc-wb-empty">还没有改过文件。</p>
            ) : (
              data.files.map(f => (
                <div key={f.path} className="cc-wb-row">
                  <span className="cc-wb-path" title={f.path}>
                    {short(f.path)}
                  </span>
                  <span className="cc-wb-delta">
                    <span className="cc-wb-add">+{f.added}</span>{' '}
                    <span className="cc-wb-del">-{f.removed}</span>
                    {f.count > 1 ? (
                      <span className="text-[var(--color-text-disabled)]"> ×{f.count}</span>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ③ 回退点 */}
        <div className="cc-wb-card">
          <div className="cc-wb-head">
            <span className="cc-wb-title">回退点</span>
            <span className="cc-wb-count">{data.checkpoints.length}</span>
          </div>
          <div className="cc-wb-body">
            {!data.live ? (
              <p className="cc-wb-empty">
                会话休眠了（闲置超时或手动收掉），文件备份跟着子进程一起没了，这里回不了。
                想撤销就用 git —— 改了哪些文件左边那格有记录。
              </p>
            ) : data.checkpoints.length === 0 ? (
              <p className="cc-wb-empty">每说一句话就多一个回退点，说完第一句这里就有了。</p>
            ) : (
              <>
                {data.checkpoints.map(c => (
                  <div key={c.uuid} className="cc-wb-row">
                    <span className="text-[var(--color-text-disabled)]">{timeText(c.at)}</span>
                    <span className="min-w-0 flex-1 truncate" title={c.label}>
                      {c.label}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        className="cc-btn-ghost"
                        disabled={rewinding === c.uuid}
                        onClick={() => void rewind(c.uuid, true)}
                      >
                        看会改什么
                      </button>
                      <button
                        type="button"
                        className="cc-btn-ghost"
                        disabled={rewinding === c.uuid}
                        onClick={() => void rewind(c.uuid, false)}
                        title="把文件还原到说这句话之前的样子"
                      >
                        退回这里
                      </button>
                    </span>
                  </div>
                ))}
                {rewindNote ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                    {rewindNote}
                  </p>
                ) : null}
                <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-text-disabled)]">
                  只还原文件，不会撤掉对话 —— 模型还记得它做过什么。
                </p>
              </>
            )}
          </div>
        </div>

        {/* ④ 命令输出 */}
        <div className="cc-wb-card lg:col-span-2">
          <div className="cc-wb-head">
            <span className="cc-wb-title">命令输出</span>
            <span className="cc-wb-count">{data.commands.length}</span>
          </div>
          <div className="cc-wb-body space-y-3">
            {data.commands.length === 0 ? (
              <p className="cc-wb-empty">还没跑过命令。build 报错那种长输出会放这里，不在气泡里刷屏。</p>
            ) : (
              data.commands.map(c => (
                <div key={c.id}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="cc-wb-path">{c.command}</span>
                    <span className="cc-wb-delta text-[var(--color-text-disabled)]">
                      {timeText(c.at)}
                    </span>
                  </div>
                  <div className="cc-wb-pre">{c.output || '（没有输出）'}</div>
                  {c.truncated ? (
                    <p className="mt-1 text-[10.5px] text-[var(--color-text-disabled)]">
                      输出太长，只留了前面 4000 字
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
