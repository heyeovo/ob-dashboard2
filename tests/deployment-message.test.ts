import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CcMessageRow from '@/app/cc/CcMessageRow'
import { DEPLOY_RETRY_NOTE } from '@/app/cc/deploymentRetry'
import type { CcMessage } from '@/app/cc/types'

function render(overrides: Partial<CcMessage>) {
  return renderToStaticMarkup(createElement(CcMessageRow, {
    message: { id: 'pending', role: 'assistant', text: '', createdAt: Date.now(), ...overrides },
    isCurrentTurn: true, onCopy: () => {}, onRetryPersistence: () => {},
  }))
}
describe('deployment feedback on an empty assistant bubble', () => {
  it('shows the existing generation indicator and gray detached note together', () => {
    const html = render({ streaming: true, deliveryState: 'detached', deliveryNote: DEPLOY_RETRY_NOTE })
    expect(html).toContain('cc-assistant-pending')
    expect(html).toContain(DEPLOY_RETRY_NOTE)
    expect(html).toContain('text-[var(--color-text-tertiary)]')
    expect(html).not.toContain('aria-label="复制消息"')
  })
  it('retains a clickable retry entry when deployment wait times out before any text arrives', () => {
    const html = render({ streaming: false, deliveryState: 'persistence_unknown', deliveryNote: '版本切换等待超时' })
    expect(html).toContain('版本切换等待超时')
    expect(html).toContain('cursor-pointer')
    expect(html).not.toContain('aria-label="复制消息"')
  })
})
