import type {
  AnchorProposal,
  PortraitScope,
  PortraitStatePayload,
  PortraitDeleteSpec,
  ProfileFact,
  ProfileFactProposal,
} from './portraitTypes'

/**
 * 画像接口的 typed 客户端。所有请求走 /api/haven 代理 → Haven server.py 直连。
 * 统一 cache:'no-store'，任何失败都抛 Error（文案优先后端 error / reason）。
 */

async function readJson(res: Response) {
  return res.json().catch(() => null) as Promise<unknown>
}

export function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.error === 'string' && record.error) return record.error
    if (typeof record.reason === 'string' && record.reason) return record.reason
    if (typeof record.message === 'string' && record.message) return record.message
  }
  return fallback
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/haven/${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  })
  const data = await readJson(res)
  if (!res.ok) {
    throw new Error(apiError(data, `请求失败（HTTP ${res.status}）`))
  }
  return data as T
}

export const portraitApi = {
  getState: () => request<PortraitStatePayload>('portrait-state'),

  maintain: () =>
    request<{ status?: string }>('portrait-maintain', {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    }),

  reset: () =>
    request('portrait-state/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'RESET' }),
    }),

  deleteItem: (spec: PortraitDeleteSpec) =>
    request('portrait-state/items', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'DELETE', ...spec }),
    }),

  saveStable: (scope: PortraitScope, text: string, expectedRevision: number) =>
    request('portrait-state/stable', {
      method: 'PUT',
      body: JSON.stringify({ scope, text, expected_revision: expectedRevision }),
    }),

  toggleStableLock: (scope: PortraitScope, locked: boolean, expectedRevision: number) =>
    request('portrait-state/stable/lock', {
      method: 'POST',
      body: JSON.stringify({ scope, locked, expected_revision: expectedRevision }),
    }),

  rollbackStable: (scope: PortraitScope, targetRevision: number, expectedRevision: number) =>
    request('portrait-state/stable/rollback', {
      method: 'POST',
      body: JSON.stringify({ scope, target_revision: targetRevision, expected_revision: expectedRevision }),
    }),

  getFacts: () => request<{ count?: number; facts: ProfileFact[] }>('profile-facts'),

  updateFact: (id: string, payload: Record<string, unknown>) =>
    request(`profile-facts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteFact: (id: string) =>
    request(`profile-facts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: 'DELETE' }),
    }),

  generateFactProposals: (bucketId: string, momentId: string) =>
    request<{ proposals?: ProfileFactProposal[]; rejected?: unknown[] }>('profile-fact-proposals', {
      method: 'POST',
      body: JSON.stringify({
        bucket_id: bucketId,
        evidence_moment_id: momentId,
        max_proposals: 3,
      }),
    }),

  confirmFactProposal: (proposal: ProfileFactProposal) =>
    request<{ id?: string }>('profile-fact-proposals/confirm', {
      method: 'POST',
      body: JSON.stringify(proposal),
    }),

  generateAnchorProposals: (bucketId: string) =>
    request<{
      proposals?: AnchorProposal[]
      rejected?: Array<{ reason?: string }>
      bucket?: Record<string, unknown>
    }>('anchor-proposals', {
      method: 'POST',
      body: JSON.stringify({ bucket_id: bucketId }),
    }),

  confirmAnchorProposal: (proposal: AnchorProposal) =>
    request<{ id?: string; status?: string }>('anchor-proposals/confirm', {
      method: 'POST',
      body: JSON.stringify(proposal),
    }),
}
