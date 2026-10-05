import { beforeEach, expect, it, vi } from 'vitest'
import { chooseTrpgTurn, kickTrpgTurn } from '@/app/lib/trpg/scheduler'
import { trpgServerRequest, type YanzhiRuntime, type YanzhiView } from '@/app/lib/trpg/server'
import { runYanzhiTurn } from '@/app/lib/trpg/yanzhiTurn'
import { runDmTurn } from '@/app/lib/trpg/dmTurn'
import { isDraining, trackDrainWork } from '@/app/lib/serverDrain'

vi.mock('@/app/lib/trpg/server', () => ({ trpgServerRequest: vi.fn() }))
vi.mock('@/app/lib/trpg/yanzhiTurn', () => ({ runYanzhiTurn: vi.fn(), trpgPublicError: () => '中文错误' }))
vi.mock('@/app/lib/trpg/dmTurn', () => ({ runDmTurn: vi.fn() }))
const finish = vi.fn()
vi.mock('@/app/lib/serverDrain', () => ({ isDraining: vi.fn(() => false), trackDrainWork: vi.fn(() => finish) }))
const runtime: YanzhiRuntime = { session_id: null, session_tokens: 0, last_seen_seq: 0, last_error: null, running_since: null }
const base: YanzhiView = { id: 'g', title: 'fake', phase: 'players', scene: null, log: [], my_character: null, companions: [], clues: [], checks: [], latest_recap: {} }
const log = (seq: number, kind: string, author = 'xiaoyang') => ({ seq, kind, author, text: 'fake', created_at: '' })
let view: YanzhiView
let saved: YanzhiRuntime
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(isDraining).mockReturnValue(false)
  view = { ...base, log: [log(1, 'table_talk')] }; saved = { ...runtime }
  vi.mocked(trpgServerRequest).mockImplementation(async (_id, endpoint, method, body) => {
    if (endpoint === 'yanzhi-view') return structuredClone(view)
    if (endpoint === 'settings') return { yanzhi_model: 'claude-opus-4-6', persona_id: '' }
    if (endpoint === 'yanzhi-runtime') { if (method === 'PUT') Object.assign(saved, body); return { ...saved } }
    if (endpoint === 'yanzhi-table-talk') view.log.push(log(view.log.length + 1, 'table_talk', 'yanzhi'))
    return { ok: true }
  })
  vi.mocked(runYanzhiTurn).mockResolvedValue({ text: '回复', session_id: 'sdk', session_tokens: 100 })
})
it('chooses table talk first, then action, checks, DM, or stops', () => {
  expect(chooseTrpgTurn(view, runtime, {})).toBe('table_talk')
  expect(chooseTrpgTurn({ ...base, phase: 'yanzhi', log: [log(3, 'action')] }, runtime, {})).toBe('action')
  expect(chooseTrpgTurn({ ...base, phase: 'yanzhi', log: [log(3, 'action')] }, runtime, { actionKey: '3' })).toBeNull()
  const check = { id: 'c', owner: 'yanzhi', status: 'pending', type: 'luck', skill: null, difficulty: 'regular', bonus: 0, penalty: 0, reason: '', san_loss: null }
  expect(chooseTrpgTurn({ ...base, phase: 'checks', checks: [check] }, runtime, {})).toBe('roll')
  expect(chooseTrpgTurn({ ...base, phase: 'checks', checks: [check] }, runtime, { checksKey: 'c' })).toBeNull()
  expect(chooseTrpgTurn({ ...base, phase: 'checks', checks: [check] }, runtime, { checksKey: 'c,other', calledChecks: new Set(['c', 'other']) })).toBeNull()
  expect(chooseTrpgTurn({ ...base, phase: 'dm' }, runtime, {})).toBe('dm')
  expect(chooseTrpgTurn(base, runtime, {})).toBeNull()
})
it('merges concurrent triggers and acknowledges own logs', async () => {
  let release!: () => void
  vi.mocked(runYanzhiTurn).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return { text: '回复', session_id: 'sdk', session_tokens: 100 } })
  const first = kickTrpgTurn('merge', 'table-talk')
  await vi.waitFor(() => expect(runYanzhiTurn).toHaveBeenCalledTimes(1))
  expect(kickTrpgTurn('merge', 'table-talk')).toBe(first)
  kickTrpgTurn('merge', 'roll')
  release(); await first
  expect(runYanzhiTurn).toHaveBeenCalledTimes(1)
  expect(saved.last_seen_seq).toBe(2)
  expect(saved.session_id).toBe('sdk')
  expect(saved.running_since).toBeNull()
  expect(trackDrainWork).toHaveBeenCalledTimes(1)
  expect(finish).toHaveBeenCalledTimes(1)
})
it('responds to table talk arriving during the first model turn', async () => {
  vi.mocked(runYanzhiTurn).mockImplementationOnce(async () => {
    view.log.push(log(2, 'table_talk'))
    return { text: 'first', session_id: 'sdk', session_tokens: 1 }
  })
  await kickTrpgTurn('late-talk', 'table-talk')
  expect(runYanzhiTurn).toHaveBeenCalledTimes(2)
  expect(saved.last_seen_seq).toBe(4)
})
it('does not repeat an action-only-talk turn on subsequent triggers', async () => {
  view = { ...base, phase: 'yanzhi', log: [log(1, 'action')] }
  await kickTrpgTurn('no-repeat', 'action')
  await kickTrpgTurn('no-repeat', 'roll')
  expect(runYanzhiTurn).toHaveBeenCalledTimes(1)
})
it('calls the DM placeholder once and stops', async () => {
  view = { ...base, phase: 'dm' }
  await kickTrpgTurn('dm', 'settle')
  expect(runDmTurn).toHaveBeenCalledExactlyOnceWith('dm')
  expect(runYanzhiTurn).not.toHaveBeenCalled()
})
it('writes errors only to runtime and clears running state', async () => {
  vi.mocked(runYanzhiTurn).mockRejectedValueOnce(new Error('secret-detail'))
  await kickTrpgTurn('failed', 'table-talk')
  expect(saved.last_error).toBe('中文错误')
  expect(saved.running_since).toBeNull()
  expect(view.log).toHaveLength(1)
})
it('rejects new work during drain', async () => {
  vi.mocked(isDraining).mockReturnValue(true)
  await kickTrpgTurn('drain', 'action')
  expect(trackDrainWork).not.toHaveBeenCalled()
  expect(trpgServerRequest).not.toHaveBeenCalled()
})
