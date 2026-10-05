export type Phase = 'players' | 'yanzhi' | 'dm' | 'checks'
export const phaseLabel: Record<Phase, string> = {
  players: '轮到你们', yanzhi: '言之在想…', dm: '守秘人在写…', checks: '等掷骰',
}
export type Log = { seq: number; kind: string; author: string; text: string; created_at: string }
export type Sheet = {
  name?: string; occupation?: string; characteristics?: Record<string, number>; skills?: Record<string, number>
  hp?: number; hp_max?: number; san?: number; san_start?: number; mp?: number; luck?: number; background?: string; notes?: string
}
export type Check = { id: string; owner: string; status: string; type: string; skill: string | null; difficulty: string; bonus: number; penalty: number; reason: string; san_loss: string | null }
export type Table = {
  id: string; title: string; phase: Phase; scene: { id: string; title: string } | null; log: Log[]
  my_character: Sheet | null; companions: { owner: string; name: string; occupation: string }[]
  clues: { id: string; title: string; text: string; handout: boolean }[]; checks: Check[]
}

export function mergeLogs(existing: Log[], incoming: Log[]): Log[] {
  return [...new Map([...existing, ...incoming].map(log => [log.seq, log])).values()].sort((a, b) => a.seq - b.seq)
}

export async function trpgRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/trpg/${path}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(response.status === 409 && path === 'games' ? '已经有一局在跑了' : data.error || '请求失败，请重试')
  return data as T
}

export const fieldClass = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-base'
