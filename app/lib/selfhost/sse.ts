export type SelfhostErrorPayload = {
  code: string
  message: string
  stage: 'preflight' | 'recall' | 'upstream' | 'persistence'
  retryable: boolean
  http_status: number | null
  request_id: string
  generated_not_saved: boolean
  persistence_unknown?: boolean
  expected_last_round_id?: number
  actual_last_round_id?: number
  expected_persona_id?: string
  actual_persona_id?: string
}

export function encodeSelfhostSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

