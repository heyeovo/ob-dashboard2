import { beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TrpgTable from '@/app/trpg/[id]/TrpgTable'
import type { Table } from '@/app/lib/trpg/table'

let table: Table
let stateIndex = 0
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => {
    stateIndex++
    return actual.useState(stateIndex === 2 ? table : stateIndex === 4 ? false : initial)
  } }
})
vi.mock('@/app/components/SubpageBackButton', () => ({ default: () => null }))
vi.mock('@/app/components/BodyPortal', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/app/components/DetailPanel', () => ({ default: () => null }))
vi.mock('@/app/cc/CcMarkdown', () => ({ default: ({ text }: { text: string }) => createElement('p', null, text) }))
beforeEach(() => {
  stateIndex = 0
  table = { id: 'g', title: '假模组', phase: 'checks', ended_at: '2026-10-05 00:00:00', scene: null,
    log: [{ seq: 1, kind: 'narration', author: 'dm', text: '保留的团录', created_at: '' }],
    my_character: { name: '调查员' }, companions: [], clues: [],
    checks: [{ id: 'c', owner: 'xiaoyang', status: 'pending', type: 'luck', skill: null, difficulty: 'regular', bonus: 0, penalty: 0, reason: '', san_loss: null }] }
})

it('renders an ended archive with logs and cards but no composer, settlement or dice', () => {
  const html = renderToStaticMarkup(createElement(TrpgTable, { gameId: 'g' }))
  expect(html).toContain('这局结束了 · 2026/10/5')
  expect(html).toContain('保留的团录')
  expect(html).toContain('角色卡')
  expect(html).not.toContain('textarea')
  expect(html).not.toContain('直接结算')
  expect(html).not.toContain('掷骰')
  expect(html).not.toContain('言之在想')
})
it('keeps the composer and pending dice available in an ongoing game', () => {
  table.ended_at = null
  const html = renderToStaticMarkup(createElement(TrpgTable, { gameId: 'g' }))
  expect(html).toContain('textarea')
  expect(html).toContain('掷骰')
  expect(html).not.toContain('这局结束了')
})
