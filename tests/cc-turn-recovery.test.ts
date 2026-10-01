import { describe, expect, it } from 'vitest'
import { mergeTurnMessages } from '@/app/cc/turnRecovery'
import type { CcMessage } from '@/app/cc/types'

describe('turn recovery from Haven', () => {
  it('replaces both placeholders by request ID and preserves render keys without duplication', () => {
    const previous: CcMessage[] = [
      { id: 'local-user', role: 'user', requestId: 'r', text: 'hello', createdAt: 1 },
      { id: 'local-assistant', role: 'assistant', requestId: 'r', text: 'partial', createdAt: 1, deliveryState: 'detached' },
    ]
    const incoming: CcMessage[] = [
      { id: 'saved-user', role: 'user', requestId: 'r', text: 'hello', createdAt: 1 },
      { id: 'saved-assistant', role: 'assistant', requestId: 'r', text: 'complete', createdAt: 1, deliveryState: 'saved' },
    ]
    const merged = mergeTurnMessages(previous, incoming)
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ id: 'saved-assistant', text: 'complete', renderKey: 'local-assistant', deliveryState: 'saved' })
    expect(mergeTurnMessages(merged, incoming)).toEqual(merged)
  })

  it('keeps unrelated messages and appends genuinely new rounds', () => {
    const message: CcMessage = { id: 'old', role: 'assistant', text: 'old', createdAt: 1 }
    const incoming: CcMessage = { id: 'new', role: 'assistant', requestId: 'new-r', text: 'new', createdAt: 2 }
    expect(mergeTurnMessages([message], [incoming])).toEqual([message, incoming])
  })
})
