export type RecallMode = '' | 'on' | 'off'

export function resolveRecallEnabled(
  explicit: boolean | undefined,
  recallMode: RecallMode | undefined,
  mode: 'chat' | 'work',
): boolean {
  if (explicit !== undefined) return explicit
  if (recallMode === 'on') return true
  if (recallMode === 'off') return false
  return mode === 'chat'
}
