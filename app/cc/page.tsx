'use client'
import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import CcComposer from './CcComposer'
import CcMessageRow from './CcMessageRow'
import CcPersonaDialog from './CcPersonaDialog'
import CcPersonaRail from './CcPersonaRail'
import CcRecallDialog from './CcRecallDialog'
import CcSessionRail from './CcSessionRail'
import { draftPersona, type CcPersona } from './persona'
import { useCcChat } from './useCcChat'
import { usePersonas } from './usePersonas'
import type { CcMessage } from './types'

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

export default function CcChatPage() {
  const people = usePersonas()
  const chat = useCcChat(people.activeId)
  const [railOpen, setRailOpen] = useState(false)
  // 协作者：左上角开列表，右上角开设置。settingsFor 为 null 就是没开设置。
  const [personaRailOpen, setPersonaRailOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<CcPersona | null>(null)
  const [recallDetail, setRecallDetail] = useState<CcMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新消息进来滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages])

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
  }

  const cacheLeft = formatCacheLeft(chat.stats.cacheRemainingMs)

  const header = (
    <div className="cc-topbar flex items-center gap-3 px-4 py-2.5">
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
        <span className="max-w-[7rem] truncate">{people.active.name}</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {chat.messages.find(m => m.role === 'user')?.text.slice(0, 40) || '新对话'}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-text-disabled)]">
          <span>只读模式</span>
          <span>·</span>
          <span>{chat.stats.turnCount} 轮</span>
          {/* 花费只在这个进程还活着时显示。读回来的历史算不出钱 ——
              不同中转站、不同模型价格不一样，要一张价格表，见 HANDOFF 待办。
              这时候显示 $0 是在骗人，不如不显示。 */}
          {chat.stats.totalCostUsd > 0 ? (
            <>
              <span>·</span>
              <span>{formatCost(chat.stats.totalCostUsd)}</span>
            </>
          ) : null}
          {cacheLeft ? (
            <>
              <span>·</span>
              <span title="Anthropic prompt cache 剩余有效时间。过期后下一句要重付一次缓存写入（≈$0.27）">
                缓存 {cacheLeft}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {/* 右：配当前这个协作者 */}
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
  )

  const thread = (
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-[var(--chat-assistant-width)] flex-col gap-7">
        {chat.historyLoading ? (
          <div className="py-10 text-center text-xs text-[var(--color-text-disabled)]">读取历史</div>
        ) : chat.messages.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-sm text-[var(--color-text-secondary)]">开始一段对话</div>
            <div className="mt-1.5 text-xs text-[var(--color-text-disabled)]">
              记忆会在你发言时自动注入，回复下方能看到召回了什么
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

  return (
    <>
      {/* 桌面端：NavBar + 左会话列表 + 右对话 */}
      <div className="cc-page hidden h-screen flex-col md:flex">
        <NavBar activeSlug="cc" />
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

      {/* 召回详情：按模块分段。⚠️ 各模块的正文服务端还没回传（见组件内注释） */}
      {recallDetail ? (
        <CcRecallDialog message={recallDetail} onClose={() => setRecallDetail(null)} />
      ) : null}
    </>
  )
}
