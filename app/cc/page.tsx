'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import CcComposer from './CcComposer'
import CcMessageRow from './CcMessageRow'
import { CcPermCard } from './CcPermCard'
import CcPersonaDialog from './CcPersonaDialog'
import CcPersonaRail from './CcPersonaRail'
import CcRecallDialog from './CcRecallDialog'
import CcSessionRail from './CcSessionRail'
import { draftPersona, type CcPersona } from './persona'
import { useCcChat } from './useCcChat'
import { useIsRemote } from './useIsRemote'
import { usePersonas } from './usePersonas'
import type { CcMessage } from './types'
import CcWindowSettings from './CcWindowSettings'
import { MODE_HINT, MODE_LABEL } from '@/app/lib/ccModes'

// 第 4 步的聊天页。
//
// 引擎：cc（claude code Agent SDK 子进程），走 /api/cc-chat 的 SSE。
// 记忆：UserPromptSubmit hook → Haven /api/hook/recall（服务端做，前端只看结果）。
// 存储：每轮写回 Haven 的 conversation_turns，跟 Polaris 同一张表。
// 权限：第一版只读（Read / Grep / Glob）。写文件和跑命令等第 5 步的 diff 批准。
//
// ⚠️ / 上那个 Polaris iframe 保持不动，两个并存。等这页用顺了再谈谁接管 /。

function formatCost(usd: number) {
  if (!usd) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function formatCacheLeft(ms: number) {
  if (ms <= 0) return null
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60 ? `${sec % 60}s` : ''}`
}

/** 「23.4k / 1M」。上下文用量胶囊用。 */
function formatTokens(n: number) {
  if (n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

function CcRemoteNotice() {
  return (
    <div className="cc-page flex min-h-screen items-center justify-center px-6 pb-24">
      <div className="max-w-md rounded-2xl border border-[var(--color-border)] bg-white/80 px-6 py-7 text-center backdrop-blur-md">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#E8A58F]">
          <svg className="h-6 w-6" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 9.5c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5S13.6 15 10 15c-.8 0-1.6-.1-2.3-.3L4 16l.9-2.6c-.9-1-1.4-2.3-1.4-3.9Z" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-[var(--color-text-heading)]">这一页要在家里的电脑上用</h1>
        <p className="mb-5 text-sm leading-relaxed text-[var(--color-text-tertiary)]">
          这个聊天页要在本机跑 claude code，线上服务器上起不来。
          在家开着电脑的 dev server，用电脑或同一个 wifi 下的手机访问，就能正常聊。
        </p>
        <div className="space-y-2 text-left">
          <Link
            href="/polaris"
            className="block rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm transition-all hover:border-[var(--color-primary)]/30 hover:shadow-md"
          >
            <span className="font-semibold text-[var(--color-text-heading)]">在外面先用 Polaris 聊 →</span>
            <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">走 Haven，跟以前一样，记忆照旧</span>
          </Link>
          <Link
            href="/"
            className="block rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm transition-all hover:border-[var(--color-primary)]/30 hover:shadow-md"
          >
            <span className="font-semibold text-[var(--color-text-heading)]">回主页 →</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function CcChatPage() {
  const isRemote = useIsRemote()
  const people = usePersonas()
  const chat = useCcChat(people.activeId)
  const [railOpen, setRailOpen] = useState(false)
  // 协作者：左上角开列表，右上角开设置。settingsFor 为 null 就是没开设置。
  const [personaRailOpen, setPersonaRailOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<CcPersona | null>(null)
  const [recallDetail, setRecallDetail] = useState<CcMessage | null>(null)
  const [winSetOpen, setWinSetOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新消息进来滚到底。批准卡片出现时也滚 —— 不滚就可能在屏幕外，人不知道在等他
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages, chat.pending.length])

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
  }

  // 缓存两档分开显示。5 分钟一过不是「缓存没了」—— 系统提示那几万字走 1h 档还在，
  // 以前一刀切按 5 分钟显示，比真实情况悲观，会催着人赶紧说话。
  const cacheSession = formatCacheLeft(chat.stats.cacheRemainingMs)
  const cacheSystem = formatCacheLeft(chat.stats.cacheSystemRemainingMs)
  // 顶部显示实际在跑的那个模型（stats.model 来自服务端）；进程没起来就显示这一窗选的
  const shownModel = chat.stats.model || chat.pick.model
  const ctxMax = chat.stats.contextMaxTokens
  const totalChars = chat.messages.reduce((n, m) => n + m.text.length, 0)

  const header = (
    <div className="cc-topbar flex items-center gap-2 px-3 py-2.5 md:gap-3 md:px-4">
      <button
        type="button"
        onClick={() => setRailOpen(true)}
        className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] md:hidden"
      >
        对话
      </button>
      {/* 左：当前协作者，点开换人 */}
      <button
        type="button"
        onClick={() => setPersonaRailOpen(true)}
        className="cc-persona-chip"
        title="切换协作者"
      >
        <span className="cc-avatar" style={{ background: people.active.tint }} aria-hidden="true">
          {people.active.initial}
        </span>
        {/* 手机上只留头像，名字省掉 —— 顶栏横向就那么点地方 */}
        <span className="hidden max-w-[7rem] truncate md:inline">{people.active.name}</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {chat.messages.find(m => m.role === 'user')?.text.slice(0, 40) || '新对话'}
        </div>
        {/* ⚠️ 一行到底不换行：手机上换行会把整条顶栏顶成半屏高。
            手机只留「模式 · N 轮」，其余（模型名 / 上下文 / 花费 / 缓存）
            md 以上才出现，手机想看去「本窗」弹窗里看。 */}
        <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden whitespace-nowrap text-[11px] text-[var(--color-text-disabled)]">
          <span>{MODE_LABEL[chat.mode]}模式</span>
          {shownModel ? (
            <>
              <span className="hidden md:inline">·</span>
              <span className="hidden max-w-[11rem] truncate md:inline" title={shownModel}>
                {shownModel}
              </span>
            </>
          ) : null}
          <span>·</span>
          <span>{chat.stats.turnCount} 轮</span>
          {/* 上下文用量。上限拿不到（进程还没起）就不显示分母，别编一个 */}
          {chat.stats.contextTokens > 0 ? (
            <>
              <span className="hidden md:inline">·</span>
              <span className="hidden md:inline" title="这个对话现在占了多少上下文">
                {formatTokens(chat.stats.contextTokens)}
                {ctxMax > 0 ? ` / ${formatTokens(ctxMax)}` : ''}
              </span>
            </>
          ) : null}
          {/* 花费只在这个进程还活着时显示。读回来的历史算不出钱 ——
              不同中转站、不同模型价格不一样，要一张价格表，见 HANDOFF 待办。
              这时候显示 $0 是在骗人，不如不显示。 */}
          {chat.stats.totalCostUsd > 0 && chat.pick.kind !== 'subscription' ? (
            <>
              <span className="hidden md:inline">·</span>
              <span className="hidden md:inline">{formatCost(chat.stats.totalCostUsd)}</span>
            </>
          ) : null}
          {cacheSystem ? (
            <>
              <span className="hidden md:inline">·</span>
              <span
                className="hidden md:inline"
                title="Anthropic prompt cache 两档：系统提示 + 工具说明进 1 小时档，会话消息进 5 分钟档。5 分钟过了不等于缓存全没，接着聊仍然便宜。"
              >
                缓存 {cacheSystem}
                {cacheSession ? ` / 会话 ${cacheSession}` : ' / 会话已过期'}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {/* 右：本窗口设置（这一个对话的模型/供应商）+ 协作者设置（跨对话的人设） */}
      <div className="flex shrink-0 items-center gap-1 md:gap-2">
        <button
          type="button"
          onClick={() => setWinSetOpen(true)}
          aria-label="本窗口设置"
          title="本窗口设置：模型 / 力度 / 供应商"
          className="cc-icon-btn"
        >
          本窗
        </button>
        <button
          type="button"
          onClick={() => setSettingsFor(people.active)}
          aria-label="协作者设置"
          title="协作者设置"
          className="cc-icon-btn"
        >
          设置
        </button>
      </div>
    </div>
  )

  const thread = (
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-[var(--chat-assistant-width)] flex-col gap-7">
        {chat.historyLoading ? (
          <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史</div>
        ) : chat.messages.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-[13.5px] font-medium text-[var(--color-text-heading)]">开始一段对话</div>
            <div className="mt-1.5 text-[11.5px] text-[var(--color-text-disabled)]">
              记忆会在你发言时自动注入，回复下方能看到召回了什么
            </div>
            {/* 模式只能在这里选：第一句话一发，systemPrompt 和工具就随子进程定死了 */}
            <div className="mx-auto mt-7 flex max-w-[420px] gap-2.5 text-left">
              {(['chat', 'work'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => chat.setMode(m)}
                  className={`flex-1 rounded-[var(--radius-lg)] border px-3.5 py-3 transition-colors ${
                    chat.mode === m
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/40'
                  }`}
                >
                  <span className="block text-[12.5px] font-medium text-[var(--color-text-heading)]">
                    {MODE_LABEL[m]}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
                    {MODE_HINT[m]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map(m => (
            <CcMessageRow
              key={m.id}
              message={m}
              // 按那一轮记下的人画头像名字；老消息没记就用当前选中的
              persona={
                (m.personaId && people.personas.find(p => p.id === m.personaId)) || people.active
              }
              onCopy={copy}
              onEditAndResend={m.fromHistory ? undefined : text => chat.setDraft(text)}
              onOpenRecall={setRecallDetail}
            />
          ))
        )}
        {/* 等着点批准的操作。放在消息流最后 —— 那一轮正停在这里等，
            它就是「现在该看的东西」。刷新页面不会丢（队列在服务端）。 */}
        {chat.pending.map(req => (
          <CcPermCard key={req.id} request={req} onAnswer={chat.answerPermission} />
        ))}
        {chat.autoAllowEdits ? (
          <div className="cc-auto-allow">
            <span>这次对话里改文件不再一条条问了（跑命令仍然每次都问）</span>
            <button
              type="button"
              className="ml-auto shrink-0 underline"
              onClick={() => void chat.stopAutoAllow()}
            >
              改回每次都问
            </button>
          </div>
        ) : null}
        {chat.error ? (
          <div className="rounded-[var(--radius-lg)] bg-[#FCEEED] px-3.5 py-2.5 text-xs text-[var(--color-danger)]">
            {chat.error}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  )

  const composer = (
    <div className="px-4 pb-4 pt-1">
      <div className="mx-auto max-w-[var(--chat-assistant-width)]">
        <CcComposer
          value={chat.draft}
          onChange={chat.setDraft}
          onSubmit={() => chat.send(chat.draft)}
          onStop={chat.stop}
          sending={chat.sending}
        />
      </div>
    </div>
  )

  const rail = (
    <CcSessionRail
      sessions={chat.sessions}
      activeSessionId={chat.sessionId}
      loading={chat.sessionsLoading}
      onPick={id => {
        setRailOpen(false)
        void chat.switchSession(id)
      }}
      onNew={() => {
        setRailOpen(false)
        chat.startNewSession()
      }}
    />
  )

  // 协作者列表：桌面端和手机端都是从左侧盖上来的浮层。
  // 桌面端左边那栏是会话列表，两个东西不能抢同一个位置。
  const personaRail = personaRailOpen ? (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="关闭协作者列表"
        onClick={() => setPersonaRailOpen(false)}
        className="absolute inset-0 bg-black/20"
      />
      <div className="absolute left-0 top-0 h-full w-[78%] max-w-[300px] bg-[var(--color-surface)] shadow-xl">
        <CcPersonaRail
          personas={people.personas}
          activeId={people.activeId}
          loading={people.loading}
          onPick={id => {
            setPersonaRailOpen(false)
            if (id === people.activeId) return
            people.selectPersona(id)
            // 换人 = 换一整套对话。开着的那个属于上一个协作者，留在屏幕上会串，
            // 直接开一个新的空对话。
            chat.startNewSession()
          }}
          onNew={() => {
            setPersonaRailOpen(false)
            setSettingsFor(draftPersona())
          }}
          onClose={() => setPersonaRailOpen(false)}
        />
      </div>
    </div>
  ) : null

  // 线上（Vercel）打开这一页：claude code 子进程起不来，给一句话说清楚，
  // 别让人发一句话再对着报错猜。本地 / 局域网都照常走下面的完整界面。
  if (isRemote) return <CcRemoteNotice />

  return (
    <>
      {/* 桌面端：左会话列表 + 右对话（导航是全局左侧竖栏，这一页不带顶部横条） */}
      <div className="cc-page hidden h-screen flex-col md:flex">
        <div className="flex min-h-0 flex-1">
          <aside className="cc-rail-pane w-[var(--chat-rail-width)] shrink-0">{rail}</aside>
          <main className="flex min-w-0 flex-1 flex-col">
            {header}
            {thread}
            {composer}
          </main>
        </div>
      </div>

      {/* 手机端：全屏对话，会话列表从左侧滑入 */}
      <div
        className="cc-page flex flex-col md:hidden"
        style={{ height: 'calc(100dvh - 76px - env(safe-area-inset-bottom, 0px))' }}
      >
        {header}
        {thread}
        {composer}
      </div>

      {railOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="关闭对话列表"
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 bg-black/20"
          />
          <div className="absolute left-0 top-0 h-full w-[78%] max-w-[300px] bg-[var(--color-surface)] shadow-xl">
            {rail}
          </div>
        </div>
      ) : null}

      {personaRail}

      {settingsFor ? (
        <CcPersonaDialog
          // key = 换人就整个重挂，弹窗内部的草稿跟着重取
          key={settingsFor.id}
          persona={settingsFor}
          canDelete={people.personas.length > 1 && people.personas.some(p => p.id === settingsFor.id)}
          saving={people.saving}
          onSave={async persona => {
            const res = await people.savePersona(persona)
            // 新建的：保存成功就切过去
            if (res.ok && res.persona) {
              people.selectPersona(res.persona.id)
              setSettingsFor(res.persona)
            }
            return { ok: res.ok }
          }}
          onDelete={people.deletePersona}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}

      {people.error ? (
        <div className="cc-persona-error">{people.error}</div>
      ) : null}

      {/* 本窗口设置：只管这一个对话。模型/力度/思考当场生效，供应商要新建对话 */}
      {winSetOpen ? (
        <CcWindowSettings
          sessionId={chat.sessionId}
          stats={chat.stats}
          totalChars={totalChars}
          upstream={chat.upstream}
          pick={chat.pick}
          onPick={next => void chat.applyPick(next)}
          locked={chat.modeLocked}
          note={chat.settingsNote}
          onClose={() => {
            setWinSetOpen(false)
            chat.setSettingsNote('')
          }}
        />
      ) : null}

      {/* 召回详情：按模块分段。⚠️ 各模块的正文服务端还没回传（见组件内注释） */}
      {recallDetail ? (
        <CcRecallDialog message={recallDetail} onClose={() => setRecallDetail(null)} />
      ) : null}
    </>
  )
}
