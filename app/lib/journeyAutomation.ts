export type JourneyCandidateType = 'no_change' | 'append_current' | 'transition'
export type JourneyCandidateStatus =
  | 'pending'
  | 'approved'
  | 'applying'
  | 'completed'
  | 'rejected'
  | 'conflict'
  | 'failed'

export type EvidenceBucket = {
  id: string
  name: string
}

export type AutomationCandidate = {
  candidate_id: string
  run_id: string
  task_type: string
  candidate_type: JourneyCandidateType
  status: JourneyCandidateStatus
  revision: number
  rationale: string[]
  evidence: EvidenceBucket[]
  preview: Record<string, unknown>
  draft: Record<string, unknown>
  draft_preview?: Record<string, unknown>
  draft_evidence?: EvidenceBucket[]
  draft_payload_hash?: string
  approved_payload_hash?: string
  result?: Record<string, unknown>
  error?: string
  created_at?: string
  updated_at?: string
}

export type AutomationRun = {
  run_id?: string
  status?: string
  cycle_key?: string
  window_start?: string
  window_end?: string
  timezone?: string
  trigger?: string
  error?: string
  started_at?: string
  completed_at?: string
  input_summary?: {
    persona?: { id?: string; name?: string }
    current_journey?: { id?: string; name?: string; status?: string }
    daily_review_count?: number
    missing_daily_review_dates?: string[]
    material_count?: number
    materials?: Array<{
      id: string
      name: string
      material_kinds?: string[]
    }>
  }
}

export type AutomationStatus = {
  task_type: string
  schedule: {
    enabled?: boolean
    timezone?: string
    next_run_at?: string
    last_run_at?: string
    last_error?: string
    policy?: Record<string, unknown>
    execution_engine?: 'api' | 'pro'
    execution_model?: string
  }
  latest_run: AutomationRun
  latest_execution?: {
    execution_id?: string
    trigger?: string
    requested_engine?: string
    actual_engine?: string
    model?: string
    status?: string
    error_code?: string
    error?: string
    started_at?: string
    completed_at?: string
  }
  pending_candidates: number
}

type ErrorPayload = Record<string, unknown> & {
  error?: string
  message?: string
  status?: string
  candidate?: AutomationCandidate
  conflict?: { code?: string; message?: string; details?: Record<string, unknown> }
}

export class AutomationRequestError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly payload: ErrorPayload,
  ) {
    super(message)
    this.name = 'AutomationRequestError'
  }
}

export function journeyCandidateStatusText(status: JourneyCandidateStatus) {
  const labels: Record<JourneyCandidateStatus, string> = {
    pending: '待确认',
    approved: '已批准',
    applying: '执行中',
    completed: '已完成',
    rejected: '已拒绝（零写入）',
    conflict: '有冲突，请刷新或重新生成',
    failed: '执行失败，可查看错误后重试',
  }
  return labels[status] || status
}

export function automationReviewErrorMessage(error: unknown) {
  if (!(error instanceof AutomationRequestError)) {
    return error instanceof Error ? error.message : String(error)
  }
  const status = String(error.payload.status || '')
  if (status === 'revision_mismatch') return '候选已经有了新版本。请刷新后按最新 revision 重新审核。'
  if (status === 'approved_payload_changed') return '页面显示的稿件或 hash 已过期。请刷新候选后再确认。'
  if (status === 'conflict') {
    return error.payload.conflict?.message || '开放 journey 或证据已经变化，请重新生成候选。'
  }
  if (status === 'not_pending') return '这条候选已经处理，不能再次编辑或拒绝。'
  if (status === 'failed') return error.payload.error || error.message || '候选执行失败，请查看运行错误后重试。'
  return error.message
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const payload = await response.json().catch(() => ({})) as ErrorPayload
  if (!response.ok) {
    const message = payload.conflict?.message
      || payload.error
      || payload.message
      || `请求失败（HTTP ${response.status}）`
    throw new AutomationRequestError(message, response.status, payload)
  }
  return payload as T
}

export function candidateConfirmBody(candidate: Pick<AutomationCandidate, 'revision' | 'draft_payload_hash' | 'approved_payload_hash'>) {
  return {
    expected_revision: candidate.revision,
    approved_payload_hash: candidate.draft_payload_hash || candidate.approved_payload_hash || '',
  }
}

export function fetchWeeklyJourneyStatus() {
  return requestJson<AutomationStatus>('/api/automations/status?task_type=weekly_journey')
}

export function fetchDailyReviewStatus() {
  return requestJson<AutomationStatus>('/api/automations/status?task_type=daily_review')
}

export function updateWeeklyJourneySchedule(input: {
  enabled: boolean
  weekday: number
  hour: number
  minute: number
  personaId: string
}) {
  return requestJson<{ task_type: string; schedule: AutomationStatus['schedule'] }>(
    '/api/automations/schedule',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_type: 'weekly_journey',
        enabled: input.enabled,
        policy: {
          weekday: input.weekday,
          hour: input.hour,
          minute: input.minute,
          persona_id: input.personaId,
        },
      }),
    },
  )
}

export function updateAutomationExecution(
  taskType: 'daily_review' | 'weekly_journey',
  engine: 'api' | 'pro',
  model: string,
) {
  return requestJson<{ task_type: string; schedule: AutomationStatus['schedule'] }>(
    '/api/automations/execution',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_type: taskType, engine, model }),
    },
  )
}

export function runWeeklyJourney(personaId: string) {
  return requestJson<{
    status: string
    run: AutomationRun
    candidate?: AutomationCandidate
    error?: string
  }>('/api/automations/weekly-journey/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona_id: personaId }),
  })
}

export function listJourneyCandidates(status = 'all') {
  const params = new URLSearchParams({ task_type: 'weekly_journey', status, limit: '50' })
  return requestJson<{ task_type: string; count: number; items: AutomationCandidate[] }>(
    `/api/automations/candidates?${params}`,
  )
}

export function getJourneyCandidate(candidateId: string) {
  return requestJson<{ candidate: AutomationCandidate; run: AutomationRun }>(
    `/api/automations/candidates/${encodeURIComponent(candidateId)}`,
  )
}

export function saveJourneyCandidate(candidateId: string, expectedRevision: number, draft: Record<string, unknown>) {
  return requestJson<{ status: string; candidate: AutomationCandidate }>(
    `/api/automations/candidates/${encodeURIComponent(candidateId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: expectedRevision, draft }),
    },
  )
}

export function rejectJourneyCandidate(candidateId: string, expectedRevision: number) {
  return requestJson<{ status: string; candidate: AutomationCandidate }>(
    `/api/automations/candidates/${encodeURIComponent(candidateId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: expectedRevision }),
    },
  )
}

export function confirmJourneyCandidate(candidate: AutomationCandidate) {
  return requestJson<{
    status: string
    candidate: AutomationCandidate
    result?: Record<string, unknown>
    conflict?: { code?: string; message?: string; details?: Record<string, unknown> }
  }>(`/api/automations/candidates/${encodeURIComponent(candidate.candidate_id)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidateConfirmBody(candidate)),
  })
}
