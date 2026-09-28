'use client'
import CcComposer from './CcComposer'
import { extractXhsUrl } from './CcXhsCard'
import { requiresImportedSessionHandoff } from './engineRouting'
import type { CcChatScope } from './CcChatScope'

export default function CcChatComposer({ scope }: { scope: CcChatScope }) {
  const { chat, people, xhs, selectMode, selectedMessageIds, forwardSelectedMessages,
    searchVisible, searchQuery, setSearchQuery, setActiveSearchMessageId, moveSearch,
    searchResults, activeSearchIndex, closeSearch, normalizedSearchQuery,
    setHandoffOpen, forwardedBlock, setForwardedBlock } = scope
  return (
    <div className="px-4 pb-4 pt-1">
      <div className="mx-auto max-w-[var(--chat-assistant-width)]">
        {selectMode ? (
          <div className="flex items-center justify-between rounded-2xl border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-4 py-2.5 shadow-sm">
            <span className="text-xs text-[var(--color-primary)]">
              {selectedMessageIds.size > 0 ? `已选 ${selectedMessageIds.size} 条消息` : '请选择消息'}
            </span>
            <button
              type="button"
              disabled={selectedMessageIds.size === 0}
              onClick={forwardSelectedMessages}
              className="rounded-full bg-[var(--color-primary)] px-4 py-1.5 text-xs font-medium text-[var(--color-on-primary)] disabled:opacity-40"
            >
              转发所选消息
            </button>
          </div>
        ) : (
          <>
        {searchVisible ? (
          <div className="mb-2">
            <div className="flex items-center gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 shadow-sm">
              <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.3" />
                <path d="m15.5 15.5 4 4" />
              </svg>
              <input
                data-cc-search-input
                type="search"
                value={searchQuery}
                onChange={event => {
                  setSearchQuery(event.target.value)
                  setActiveSearchMessageId('')
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  moveSearch(event.shiftKey ? -1 : 1)
                }}
                placeholder="搜索当前对话"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
              />
              <div className="flex shrink-0 items-center rounded-full bg-[var(--color-surface-secondary)] p-0.5">
                <button
                  type="button"
                  onClick={() => moveSearch(-1)}
                  disabled={searchResults.length === 0}
                  aria-label="上一个匹配结果"
                  className="flex size-7 items-center justify-center rounded-full text-xs text-[var(--color-text-secondary)] disabled:opacity-30"
                >↑</button>
                <span className="min-w-10 px-1 text-center text-2xs tabular-nums text-[var(--color-text-tertiary)]">
                  {searchResults.length > 0 ? `${Math.max(activeSearchIndex, 0) + 1}/${searchResults.length}` : '0/0'}
                </span>
                <button
                  type="button"
                  onClick={() => moveSearch(1)}
                  disabled={searchResults.length === 0}
                  aria-label="下一个匹配结果"
                  className="flex size-7 items-center justify-center rounded-full text-xs text-[var(--color-text-secondary)] disabled:opacity-30"
                >↓</button>
              </div>
              <button
                type="button"
                onClick={closeSearch}
                aria-label="关闭搜索"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-base text-[var(--color-text-tertiary)]"
              >×</button>
            </div>
            {normalizedSearchQuery && chat.hasEarlierHistory ? (
              <button
                type="button"
                onClick={() => void chat.loadEarlierHistory()}
                disabled={chat.earlierHistoryLoading}
                className="mt-1.5 w-full text-center text-meta text-[var(--color-primary)] disabled:opacity-50"
              >
                {chat.earlierHistoryLoading ? '正在搜索更早消息…' : '继续搜索更早消息'}
              </button>
            ) : null}
          </div>
        ) : null}
        {chat.isRemote === true ? (
          <div className="mb-2 rounded-xl bg-[var(--color-primary-soft)] px-3 py-2 text-meta text-[var(--color-primary)]">
            Vercel 环境仅支持自建引擎；你的本地引擎首选没有被修改。
          </div>
        ) : null}
        {requiresImportedSessionHandoff(chat.activeSessionSource, chat.effectiveEngine) ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)] shadow-sm">
            <div>Claude Code 无法直接接回原来的 Polaris 运行会话；可切到自建引擎原窗续聊，或换窗启动新的 cc 会话。</div>
            <button
              type="button"
              onClick={() => setHandoffOpen({ fromSessionId: chat.sessionId })}
              className="mt-2 rounded-full bg-[var(--color-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]"
            >
              从这里换窗继续
            </button>
          </div>
        ) : (
          <CcComposer
            key={chat.sessionId}
            sessionId={chat.sessionId}
            value={chat.draft}
            onChange={chat.setDraft}
            onSubmit={attachments => {
              const prefix = forwardedBlock
                ? `<转发的消息 来源="${forwardedBlock.title}">\n${forwardedBlock.lines.join('\n---\n')}\n</转发的消息>\n\n`
                : ''
              const fullText = prefix + chat.draft
              const xhsUrl = extractXhsUrl(fullText)
              if (xhsUrl) {
                chat.setDraft('')
                setForwardedBlock(null)
                void (async () => {
                  const result = await xhs.loadXhsCard(xhsUrl, chat.sessionId, fullText)
                  if (result) {
                    const xhsAttachments = result.attachmentIds.map(id => ({
                      id, sessionId: chat.sessionId, filename: `xhs-image.jpg`,
                      kind: 'image' as const, mimeType: 'image/jpeg', byteSize: 0, sha256: '',
                    }))
                    chat.send(result.augmentedText, undefined, [...attachments, ...xhsAttachments])
                  } else {
                    chat.send(fullText, undefined, attachments)
                  }
                })()
                return
              }
              chat.send(fullText, undefined, attachments)
              setForwardedBlock(null)
            }}
            onStop={chat.stop}
            onClearKind={chat.clearAttachmentsByKind}
            activeImageCount={chat.activeImageCount}
            activeFileCount={chat.activeFileCount}
            promptModules={people.active.promptModules}
            promptModuleOverrides={chat.promptModuleOverrides}
            promptModulesSaving={chat.promptModulesSaving}
            onPromptModuleToggle={chat.setPromptModuleEnabled}
            onError={chat.setError}
            sending={chat.sending || xhs.loading}
            disabled={xhs.loading}
            placeholder={xhs.loading ? '📕 正在读取小红书笔记…' : undefined}
            forwardedBlock={forwardedBlock}
            onClearForward={() => setForwardedBlock(null)}
          />
        )}
          </>
        )}
      </div>
    </div>
  )
}
