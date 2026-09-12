import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readSystemPromptAudit, writeSystemPromptAudit } from '@/app/lib/cc/systemPromptAudit'

describe('system prompt audit snapshot', () => {
  it('persists only the last actual Dashboard prompt by conversation session', async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), 'ob2-prompt-audit-'))
    try {
      const first = {
        version: 1 as const,
        requestId: 'request-1',
        recordedAt: '2026-09-12T12:00:00.000Z',
        mode: 'chat' as const,
        systemHash: 'hash-1',
        sdkShape: 'custom' as const,
        dashboardAppend: '第一版 system prompt',
      }
      await writeSystemPromptAudit('session-a', first, { storeRoot })
      expect(await readSystemPromptAudit('session-a', { storeRoot })).toEqual(first)

      const second = { ...first, requestId: 'request-2', systemHash: 'hash-2', dashboardAppend: '热更新后的 system prompt' }
      await writeSystemPromptAudit('session-a', second, { storeRoot })
      expect(await readSystemPromptAudit('session-a', { storeRoot })).toEqual(second)
      expect(await readSystemPromptAudit('session-b', { storeRoot })).toBeNull()
    } finally {
      await rm(storeRoot, { recursive: true, force: true })
    }
  })
})
