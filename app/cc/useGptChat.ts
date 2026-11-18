'use client'
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction, type RefObject } from 'react'
import type { CcAttachment, CcMessage, GptRequest } from './types'
import { consumeGptResponse, ensureGptMessages } from './gptChatUi'
import { newTurnRequestId } from './engineRouting'
import { mergeTurnMessages } from './turnRecovery'
import { turnsToMessages, type HavenTurnRow } from './ccHistory'
import { clearGptRetryDraft, readGptRetryDraft, saveGptRetryDraft } from './gptRetryDraft'

function retryStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage } catch { return undefined }
}

type Options = {
  sessionId: string; personaId: string; enabled: boolean; ready: boolean; model: string; mode: string
  messagesRef: RefObject<CcMessage[]>; currentSessionRef: RefObject<string>
  abortRef: RefObject<AbortController | null>; lastRoundIdRef: RefObject<number>
  setMessages: Dispatch<SetStateAction<CcMessage[]>>; setSending: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>; setDraft: Dispatch<SetStateAction<string>>
  requestContext: () => Pick<GptRequest, 'include_daily_review' | 'handoff_snapshot'>
  accepted: () => void; saved: () => void
  attention?: () => void
  refreshPermissions?: () => void
}

/** Browser subscription only: disconnecting this hook never cancels the server job. */
export function useGptChat(options: Options) {
  const current = useRef(options)
  current.current = options
  const cursors = useRef(new Map<string, number>())
  const busy = useRef(false)
  const runningRequest = useRef<{ sessionId: string; requestId: string } | null>(null)

  const connect = useCallback(async (requestId: string, request?: GptRequest) => {
    const o = current.current
    if (!o.enabled || !o.ready || busy.current || o.abortRef.current) return
    busy.current = true
    const ac = new AbortController()
    o.abortRef.current = ac
    runningRequest.current = { sessionId: o.sessionId, requestId }
    o.setSending(true)
    const isCurrent = () => current.current.enabled && o.currentSessionRef.current === o.sessionId
    const update: typeof o.setMessages = apply => { if (isCurrent()) o.setMessages(apply) }
    try {
      const after = request ? 0 : cursors.current.get(requestId) || 0
      if (request) cursors.current.delete(requestId)
      const response = await fetch(request ? '/api/cc-chat-gpt'
        : `/api/cc-chat-gpt?session_id=${encodeURIComponent(o.sessionId)}&request_id=${encodeURIComponent(requestId)}&after_seq=${after}`, {
        method: request ? 'POST' : 'GET', cache: 'no-store', signal: ac.signal,
        ...(request ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) } : {}),
      })
      if (!isCurrent()) return
      if (request && response.status === 409) {
        const payload = await response.clone().json().catch(() => null)
        if (!isCurrent()) return
        if (['attachment_unavailable', 'attachment_invalid', 'attachment_already_sent'].includes(payload?.error?.code)) {
          const storage = retryStorage()
          if (storage) clearGptRetryDraft(storage, o.sessionId, requestId)
          update(messages => messages.filter(message => message.requestId !== requestId))
          o.setDraft(request.text)
          o.setError(payload.error.message)
          return
        }
      }
      if (request && response.ok) o.accepted()
      const result = await consumeGptResponse(response, { requestId, update, after,
        refreshPermissions: () => { if (isCurrent()) o.refreshPermissions?.() },
        received: seq => cursors.current.set(requestId, seq),
        attention: error => {
          if (!isCurrent()) return
          if (error.code === 'attachment_context_limit') {
            const storage = retryStorage()
            if (storage) clearGptRetryDraft(storage, o.sessionId, requestId)
            update(messages => messages.filter(message => message.requestId !== requestId))
            if (request) o.setDraft(request.text)
            o.setError(error.message)
          } else if (error.action) o.attention?.()
        },
        saved: round => {
          const storage = retryStorage()
          if (storage) clearGptRetryDraft(storage, o.sessionId, requestId)
          if (isCurrent()) { o.lastRoundIdRef.current = Math.max(o.lastRoundIdRef.current, round); o.saved() }
        },
      })
      // A truncated process buffer may remain unavailable even after the durable save.
      // Read canonical history too; never treat the missing buffer as permission to regenerate.
      if (result === 'pending') {
        const result = await fetch(`/api/cc-turns?session_id=${encodeURIComponent(o.sessionId)}&after_round_id=${Math.max(0, o.lastRoundIdRef.current - 1)}&limit=100&raw=1`,
          { cache: 'no-store', signal: ac.signal })
        const data = await result.json()
        if (isCurrent() && result.ok && data.ok && Array.isArray(data.turns)) {
          const turns = (data.turns as HavenTurnRow[]).filter(turn => turn.request_id === requestId && turn.source === 'gpt_subscription')
          if (turns.length) {
            update(messages => mergeTurnMessages(messages, turnsToMessages(turns)))
            o.lastRoundIdRef.current = Math.max(o.lastRoundIdRef.current, ...turns.map(turn => turn.round_id || 0))
            const storage = retryStorage()
            if (storage) clearGptRetryDraft(storage, o.sessionId, requestId)
            o.saved()
          }
        }
      }
    } catch {
      update(messages => messages.map(message => message.requestId === requestId && message.role === 'assistant'
        && !['saved', 'replayed'].includes(message.deliveryState || '')
        ? { ...message, streaming: false, deliveryState: 'detached',
          deliveryNote: '连接断了，服务器继续处理；回到页面会自动核对原请求。' } : message))
    } finally {
      busy.current = false
      runningRequest.current = null
      if (o.abortRef.current === ac) {
        o.abortRef.current = null
        if (isCurrent()) o.setSending(false)
      }
    }
  }, [])

  const send = useCallback(async (text: string, attachments: CcAttachment[], original?: GptRequest) => {
    const o = current.current
    if (!o.enabled || !o.ready || !o.sessionId || !o.personaId || busy.current || o.abortRef.current) return
    if (!original && o.mode === 'work') { o.setError('GPT 不支持工作模式。请使用闲聊窗口，或新建窗口。'); return }
    if (!original && !o.model.trim()) { o.setError('请先在本窗口设置中保存 GPT 模型。'); return }
    const storage = retryStorage()
    if (!original && storage && readGptRetryDraft(storage, o.sessionId)) {
      o.setError('上一条 GPT 请求尚未确认，请先核对保存状态。'); return
    }
    if (!original && o.messagesRef.current.some(message => message.engine === 'gpt_subscription'
      && message.role === 'assistant' && ['detached', 'persistence_unknown', 'not_saved'].includes(message.deliveryState || ''))) {
      o.setError('上一条 GPT 请求尚未确认，请先核对保存状态。'); return
    }
    const request: GptRequest = original || { session_id: o.sessionId, persona_id: o.personaId,
      request_id: newTurnRequestId(), text: text.trim(), expected_last_round_id: o.lastRoundIdRef.current,
      model: o.model, mode: 'chat', ...o.requestContext(),
      ...(attachments.length ? { attachment_ids: attachments.map(item => item.id) } : {}) }
    if (request.session_id !== o.sessionId || (!request.text.trim() && !request.attachment_ids?.length)) return
    if (storage) saveGptRetryDraft(storage, request)
    o.setMessages(messages => ensureGptMessages(messages, request, Date.now(), request).map(message =>
      message.requestId === request.request_id && message.role === 'assistant'
        ? { ...message, gptRetryRequest: request }
        : message.requestId === request.request_id && message.role === 'user' && attachments.length
          ? { ...message, attachments } : message))
    o.setDraft(''); o.setError('')
    await connect(request.request_id, request)
  }, [connect])

  const recover = useCallback(async (target?: CcMessage) => {
    const o = current.current
    if (!o.enabled || !o.ready || !o.sessionId || busy.current || o.abortRef.current || document.visibilityState !== 'visible') return
    const storage = retryStorage()
    let cached = storage ? readGptRetryDraft(storage, o.sessionId) : undefined
    const existing = cached && o.messagesRef.current.find(message => message.requestId === cached!.request_id && message.role === 'assistant')
    if (cached && storage && existing && ['saved', 'replayed'].includes(existing.deliveryState || '')) {
      clearGptRetryDraft(storage, o.sessionId, cached.request_id)
      cached = undefined
    }
    if (!target && existing && ['persistence_unknown', 'not_saved'].includes(existing.deliveryState || '')) return
    if (cached) {
      const original = cached
      o.setMessages(messages => ensureGptMessages(messages, original, Date.now(), original).map(message =>
        message.requestId === original.request_id && message.role === 'assistant' ? { ...message, gptRetryRequest: original } : message))
    }
    const pending = target || o.messagesRef.current.find(message => message.engine === 'gpt_subscription'
      && message.role === 'assistant' && message.deliveryState === 'detached')
    if (pending?.requestId || cached) {
      const id = pending?.requestId || cached!.request_id
      if (target && ['not_saved', 'persistence_unknown'].includes(target.deliveryState || '')) cursors.current.delete(id)
      await connect(id); return
    }
    busy.current = true
    try {
      const response = await fetch(`/api/cc-chat-gpt?session_id=${encodeURIComponent(o.sessionId)}`, { cache: 'no-store' })
      const data = await response.json()
      if (!current.current.enabled || o.currentSessionRef.current !== o.sessionId || !response.ok || !data.ok || !data.active_turn) return
      const active = data.active_turn
      o.setMessages(messages => ensureGptMessages(messages,
        { request_id: active.request_id, text: active.user_text }, active.started_at))
      busy.current = false
      await connect(active.request_id)
    } catch { /* Next visible/focus/poll retries the read, never a new generation. */ }
    finally { busy.current = false }
  }, [connect])

  const stop = useCallback(async () => {
    const o = current.current
    const active = runningRequest.current?.sessionId === o.sessionId ? runningRequest.current.requestId
      : o.messagesRef.current.find(message => message.engine === 'gpt_subscription' && message.role === 'assistant'
        && ['generating', 'detached'].includes(message.deliveryState || ''))?.requestId
    if (!active) { o.setError('当前没有可停止的 GPT 请求，请先核对保存状态。'); return }
    try {
      const response = await fetch('/api/cc-chat-gpt', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: o.sessionId, request_id: active }) })
      const data = await response.json()
      if (o.currentSessionRef.current !== o.sessionId) return
      if (!response.ok || !data.ok || !data.cancel_requested) throw new Error('未确认停止，请等待服务器收尾或核对保存状态。')
      o.setMessages(messages => messages.map(message => message.requestId === active && message.role === 'assistant'
        && message.deliveryState !== 'saved' ? { ...message, deliveryNote: '已请求停止，正在等待部分回复保存。' } : message))
    } catch (reason) { if (o.currentSessionRef.current === o.sessionId) o.setError((reason as Error).message || '停止请求未送达，请重试。') }
  }, [])

  useEffect(() => {
    if (!options.enabled || !options.ready) return
    const tick = () => { void recover() }
    const visibility = () => {
      if (document.visibilityState === 'hidden') current.current.abortRef.current?.abort()
      else tick()
    }
    const initial = window.setTimeout(tick, 0)
    const poll = window.setInterval(tick, 5_000)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', tick)
    return () => { window.clearTimeout(initial); window.clearInterval(poll)
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', tick) }
  }, [options.enabled, options.ready, options.sessionId, recover])
  useEffect(() => () => { current.current.abortRef.current?.abort() }, [])
  return { send, stop, recover }
}
