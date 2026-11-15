import { describe, expect, it } from 'vitest'
import { clearGptRetryDraft, readGptRetryDraft, saveGptRetryDraft } from '@/app/cc/gptRetryDraft'
import type { GptRequest } from '@/app/cc/types'

describe('per-tab GPT retry envelope', () => {
  const request: GptRequest = { session_id: 's', request_id: 'r', persona_id: 'p', text: 'original',
    expected_last_round_id: 6, model: 'chosen', mode: 'chat', recall: false, include_daily_review: true }
  function storage() {
    const values = new Map<string, string>()
    return { getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  }
  it('keeps the exact body through a remount and separates sessions', () => {
    const store = storage(); saveGptRetryDraft(store, request)
    expect(readGptRetryDraft(store, 's')).toEqual(request)
    expect(readGptRetryDraft(store, 'another')).toBeUndefined()
  })
  it('clears only the matching completed request', () => {
    const store = storage(); saveGptRetryDraft(store, request)
    clearGptRetryDraft(store, 's', 'other')
    expect(readGptRetryDraft(store, 's')).toEqual(request)
    clearGptRetryDraft(store, 's', 'r')
    expect(readGptRetryDraft(store, 's')).toBeUndefined()
  })
  it('handles unavailable or corrupt cache without inventing a request', () => {
    expect(readGptRetryDraft({ getItem: () => '{corrupt' }, 's')).toBeUndefined()
    expect(() => saveGptRetryDraft({ setItem: () => { throw new Error('quota') } }, request)).not.toThrow()
    expect(readGptRetryDraft({ getItem: () => JSON.stringify({ ...request, session_id: 'other' }) }, 's')).toBeUndefined()
  })
})
