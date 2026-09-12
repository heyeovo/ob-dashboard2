import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SystemPromptAuditSnapshot = {
  version: 1
  requestId: string
  recordedAt: string
  mode: 'chat' | 'work'
  systemHash: string
  sdkShape: 'custom' | 'claude_code_preset_append'
  dashboardAppend: string
}

function auditRoot(override?: string): string {
  if (override) return override
  const homeDir = process.env.USERPROFILE || process.env.HOME || '.'
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim() || `${homeDir}${path.sep}.claude`
  return path.join(/*turbopackIgnore: true*/ claudeConfigDir, 'ob2-context-audit-v1')
}

function snapshotPath(sessionId: string, root?: string): string {
  const encoded = Buffer.from(sessionId.trim(), 'utf8').toString('base64url') || 'missing'
  return path.join(/*turbopackIgnore: true*/ auditRoot(root), `${encoded}.json`)
}

export async function writeSystemPromptAudit(
  sessionId: string,
  snapshot: SystemPromptAuditSnapshot,
  options: { storeRoot?: string } = {},
): Promise<void> {
  if (!sessionId.trim()) return
  const file = snapshotPath(sessionId, options.storeRoot)
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(/*turbopackIgnore: true*/ file, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
}

export async function readSystemPromptAudit(
  sessionId: string,
  options: { storeRoot?: string } = {},
): Promise<SystemPromptAuditSnapshot | null> {
  if (!sessionId.trim()) return null
  try {
    const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ snapshotPath(sessionId, options.storeRoot), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || typeof parsed.dashboardAppend !== 'string') return null
    return parsed as SystemPromptAuditSnapshot
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
