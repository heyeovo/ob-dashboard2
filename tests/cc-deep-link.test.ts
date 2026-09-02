import { describe, expect, it } from 'vitest'
import { requestedCcSessionId } from '@/app/cc/useCcChat'

describe('CC Bark deep link', () => {
  it('opens the encoded session id from the query string', () => {
    expect(requestedCcSessionId('?session_id=window%3Aone')).toBe('window:one')
  })

  it('ignores an empty or oversized session id', () => {
    expect(requestedCcSessionId('?session_id=')).toBe('')
    expect(requestedCcSessionId(`?session_id=${'x'.repeat(201)}`)).toBe('')
  })
})
