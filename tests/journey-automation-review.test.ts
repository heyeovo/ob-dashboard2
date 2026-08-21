import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AutomationRequestError,
  automationReviewErrorMessage,
  candidateConfirmBody,
  confirmJourneyCandidate,
  journeyCandidateStatusText,
  saveJourneyCandidate,
  updateWeeklyJourneySchedule,
  type AutomationCandidate,
} from '@/app/lib/journeyAutomation'

function candidate(overrides: Partial<AutomationCandidate> = {}): AutomationCandidate {
  return {
    candidate_id: 'candidate-1',
    run_id: 'run-1',
    task_type: 'weekly_journey',
    candidate_type: 'append_current',
    status: 'pending',
    revision: 3,
    rationale: ['本周关系状态延续'],
    evidence: [],
    preview: {},
    draft: { append_content: '服务端草稿正文' },
    draft_payload_hash: 'a'.repeat(64),
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('weekly journey approval requests', () => {
  it('builds a confirm body with revision and hash only', () => {
    expect(candidateConfirmBody(candidate())).toEqual({
      expected_revision: 3,
      approved_payload_hash: 'a'.repeat(64),
    })
  })

  it('persists the continuous review cursor with weekly cadence settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_type: 'weekly_journey', schedule: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await updateWeeklyJourneySchedule({
      enabled: true, weekday: 0, hour: 5, minute: 0,
      personaId: 'yan-zhi', reviewedThroughDate: '2026-08-11',
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      task_type: 'weekly_journey',
      enabled: true,
      policy: {
        weekday: 0, hour: 5, minute: 0, persona_id: 'yan-zhi',
        reviewed_through_date: '2026-08-11',
      },
    })
  })

  it('never sends a temporary draft or content in the confirm request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      candidate: candidate({ status: 'completed' }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await confirmJourneyCandidate(candidate({
      draft: { append_content: '浏览器里可见的正文', summary: '摘要' },
    }))

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      expected_revision: 3,
      approved_payload_hash: 'a'.repeat(64),
    })
    expect(JSON.stringify(body)).not.toContain('正文')
    expect(body).not.toHaveProperty('draft')
  })

  it('uses the new revision and hash returned after editing', async () => {
    const edited = candidate({ revision: 4, draft_payload_hash: 'b'.repeat(64) })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'updated', candidate: edited }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', candidate: edited }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const saved = await saveJourneyCandidate('candidate-1', 3, { append_content: '新正文' })
    await confirmJourneyCandidate(saved.candidate)

    const confirmInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(confirmInit.body))).toEqual({
      expected_revision: 4,
      approved_payload_hash: 'b'.repeat(64),
    })
  })

  it('preserves readable structured conflict details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'conflict',
      conflict: {
        code: 'open_journey_changed',
        message: '当前开放 journey 已变化，请重新生成候选。',
      },
      candidate: candidate({ status: 'conflict' }),
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    await expect(confirmJourneyCandidate(candidate())).rejects.toMatchObject<Partial<AutomationRequestError>>({
      message: '当前开放 journey 已变化，请重新生成候选。',
      httpStatus: 409,
      payload: expect.objectContaining({ status: 'conflict' }),
    })
  })

  it('keeps rejected and failed states readable', () => {
    expect(journeyCandidateStatusText('rejected')).toContain('零写入')
    expect(journeyCandidateStatusText('failed')).toContain('失败')
    expect(automationReviewErrorMessage(new AutomationRequestError(
      '执行器连接失败',
      500,
      { status: 'failed', error: '执行器连接失败' },
    ))).toBe('执行器连接失败')
  })
})
