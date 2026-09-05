import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { forkSession } from '@anthropic-ai/claude-agent-sdk'
import { estimateContextTokens } from './contextTokenEstimate'

type JsonObject = Record<string, unknown>

export type ContextGcCandidate = {
  id: string
  protectKey: string
  kind: 'ob_recall' | 'search_chat' | 'breath' | 'web_search' | 'web_fetch' | 'read_bucket' | 'get_chat_context' | 'introspection' | 'read_daily_reviews'
  label: string
  detail: string
  estimatedTokens: number
  protected: boolean
  cleared: boolean
}

export type ContextGcScan = {
  ccSessionId: string
  candidates: ContextGcCandidate[]
  estimatedTokens: number
}

export type ContextGcApplyResult = {
  nextCcSessionId: string
  releasedTokens: number
  candidateCount: number
  counts: Record<string, number>
}

const MEMORY_CARD_RE = /\[memory_card id=([^\s\]]+)[^\]]*\][\s\S]*?\[\/memory_card\]/g

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function parseLines(text: string): JsonObject[] {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      const row = JSON.parse(line)
      if (!object(row)) throw new Error('not an object')
      return row as JsonObject
    } catch {
      throw new Error(`Claude transcript 第 ${index + 1} 行无法识别，已停止减负`)
    }
  })
}

async function transcriptPath(sessionId: string): Promise<string> {
  const configRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projectsRoot = join(configRoot, 'projects')
  const projectDirs = await readdir(projectsRoot, { withFileTypes: true })
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue
    const candidate = join(projectsRoot, entry.name, `${sessionId}.jsonl`)
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error(`找不到 Claude 会话 ${sessionId} 的 transcript`)
}

function contentBlocks(row: JsonObject): unknown[] {
  const message = object(row.message)
  if (!message) return []
  return Array.isArray(message.content) ? message.content : [message.content]
}

function userTextSlots(row: JsonObject): Array<{ get: () => string; set: (value: string) => void }> {
  if (row.type !== 'user') return []
  const message = object(row.message)
  if (!message) return []
  if (typeof message.content === 'string') {
    return [{ get: () => String(message.content), set: value => { message.content = value } }]
  }
  if (!Array.isArray(message.content)) return []
  return message.content.flatMap(item => {
    const block = object(item)
    if (!block || block.type !== 'text' || typeof block.text !== 'string') return []
    return [{ get: () => String(block.text), set: (value: string) => { block.text = value } }]
  })
}

function bucketFromCardId(cardId: string): string {
  const match = /^ombre:([^#\s]+)(?:#.*)?$/.exec(cardId.trim())
  return match?.[1] || ''
}

function cardTitle(card: string): string {
  return /^title:\s*(.+)$/m.exec(card)?.[1]?.trim().slice(0, 120) || 'OB 记忆召回'
}

function recallReference(bucketId: string, title: string): string {
  return `召回内容已清理：${title}（${bucketId}）`
}

function searchReference(query: string): string {
  return `已清理：曾搜索「${query}」`
}

function toolName(block: JsonObject): string {
  return String(block.name || '')
}

function isSearchChat(name: string): boolean {
  return name === 'search_chat' || name.endsWith('__search_chat')
}

type RecoverableToolKind = Exclude<ContextGcCandidate['kind'], 'ob_recall'>
type RecoverableCall = {
  kind: RecoverableToolKind
  index: number
  fingerprint: string
  label: string
  replacement: string
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const raw = object(value)
  if (raw) return `{${Object.keys(raw).sort().map(key => `${JSON.stringify(key)}:${stableJson(raw[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function short(value: unknown, max = 120): string {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function recoverableCall(block: JsonObject, indexes: Record<RecoverableToolKind, number>): RecoverableCall | null {
  if (block.type !== 'tool_use') return null
  const name = toolName(block)
  const bareName = name.split('__').at(-1)?.toLowerCase() || name.toLowerCase()
  const input = object(block.input) || {}
  let kind: RecoverableToolKind
  let label = ''
  let replacement = ''
  if (isSearchChat(name)) {
    const query = String(input.query || input.q || '').trim()
    if (!query) return null
    kind = 'search_chat'
    label = `曾搜索「${short(query, 100)}」`
    replacement = searchReference(query)
  } else if (bareName === 'breath') {
    kind = 'breath'
    const query = short(input.query, 100)
    const scope = [short(input.domain, 40), short(input.date, 30)].filter(Boolean).join(' · ')
    label = query ? `breath「${query}」` : scope ? `breath · ${scope}` : 'breath 记忆读取'
    replacement = `已清理：breath${query || scope ? `「${query || scope}」` : ''}`
  } else if (bareName === 'websearch' || bareName === 'web_search') {
    const query = String(input.query || input.q || '').trim()
    if (!query) return null
    kind = 'web_search'
    label = `WebSearch「${short(query, 100)}」`
    replacement = `已清理：曾搜索「${query}」`
  } else if (bareName === 'webfetch' || bareName === 'web_fetch') {
    const url = String(input.url || '').trim()
    if (!url) return null
    kind = 'web_fetch'
    label = `WebFetch · ${short(url, 100)}`
    replacement = `已清理：曾读取「${url}」`
  } else if (bareName === 'read_bucket') {
    kind = 'read_bucket'
    const bucketId = short(input.bucket_id, 60)
    label = bucketId ? `read_bucket「${bucketId}」` : 'read_bucket'
    replacement = `已清理：read_bucket${bucketId ? `「${bucketId}」` : ''}`
  } else if (bareName === 'get_chat_context') {
    kind = 'get_chat_context'
    const turnId = String(input.turn_id || '')
    label = `get_chat_context · turn ${turnId}`
    replacement = `已清理：get_chat_context turn ${turnId}`
  } else if (bareName === 'introspection') {
    kind = 'introspection'
    const date = short(input.created_date || input.created_from, 20)
    label = date ? `introspection · ${date}` : 'introspection'
    replacement = `已清理：introspection${date ? ` · ${date}` : ''}`
  } else if (bareName === 'read_daily_reviews') {
    kind = 'read_daily_reviews'
    const startDate = short(input.start_date, 20)
    const endDate = short(input.end_date, 20)
    const range = startDate && endDate ? `${startDate} ~ ${endDate}` : startDate || endDate || ''
    const days = input.last_days ? `最近 ${input.last_days} 天` : ''
    const scope = range || days || ''
    label = scope ? `日回顾「${scope}」` : '日回顾'
    replacement = `已清理：日回顾${scope ? `「${scope}」` : ''}`
  } else {
    return null
  }
  indexes[kind] += 1
  const fingerprint = kind === 'search_chat'
    ? String(input.query || input.q || '').trim()
    : stableJson({ name: bareName, input })
  return { kind, index: indexes[kind], fingerprint, label, replacement }
}

function candidateIdentity(call: RecoverableCall): { id: string; protectKey: string } {
  const prefix = call.kind === 'search_chat' ? 'search' : call.kind
  return {
    id: `${prefix}:${call.index}:${hash(call.fingerprint)}`,
    protectKey: `${prefix}:${hash(call.fingerprint)}`,
  }
}

function resultText(block: JsonObject): string | null {
  if (typeof block.content === 'string') return block.content
  if (!Array.isArray(block.content)) return null
  const texts: string[] = []
  for (const item of block.content) {
    const part = object(item)
    if (!part || part.type !== 'text' || typeof part.text !== 'string') return null
    texts.push(part.text)
  }
  return texts.join('\n')
}

function setResultText(block: JsonObject, value: string): void {
  if (typeof block.content === 'string') {
    block.content = value
    return
  }
  if (Array.isArray(block.content) && block.content.every(item => object(item)?.type === 'text')) {
    block.content = [{ type: 'text', text: value }]
    return
  }
  throw new Error('工具返回结构不是纯文字，已停止减负')
}

function collect(rows: JsonObject[], protectedKeys: Set<string>): ContextGcCandidate[] {
  const candidates: ContextGcCandidate[] = []
  let recallIndex = 0
  const indexes: Record<RecoverableToolKind, number> = {
    search_chat: 0, breath: 0, web_search: 0, web_fetch: 0,
    read_bucket: 0, get_chat_context: 0, introspection: 0, read_daily_reviews: 0,
  }
  const recoverableCalls = new Map<string, RecoverableCall>()

  for (const row of rows) {
    for (const slot of userTextSlots(row)) {
      const text = slot.get()
      for (const match of text.matchAll(MEMORY_CARD_RE)) {
        const bucketId = bucketFromCardId(match[1])
        if (!bucketId) continue
        recallIndex += 1
        const full = match[0]
        const title = cardTitle(full)
        const protectKey = `ob:${bucketId}`
        const fullTokens = estimateContextTokens(full)
        candidates.push({
          id: `ob:${recallIndex}:${hash(bucketId)}`,
          protectKey,
          kind: 'ob_recall',
          label: title,
          detail: `${bucketId} · 约 ${fullTokens.toLocaleString()} token`,
          estimatedTokens: Math.max(0, fullTokens - estimateContextTokens(recallReference(bucketId, title))),
          protected: protectedKeys.has(protectKey),
          cleared: false,
        })
      }
    }
    for (const rawBlock of contentBlocks(row)) {
      const block = object(rawBlock)
      if (!block) continue
      if (block.type === 'tool_use') {
        const call = recoverableCall(block, indexes)
        const id = String(block.id || '').trim()
        if (id && call) recoverableCalls.set(id, call)
      }
      if (block.type === 'tool_result') {
        const call = recoverableCalls.get(String(block.tool_use_id || '').trim())
        const text = call ? resultText(block) : null
        if (!call || text == null) continue
        const identity = candidateIdentity(call)
        const cleared = text.startsWith('已清理：') || text.startsWith('召回内容已清理：')
        const totalTokens = estimateContextTokens(text)
        candidates.push({
          id: identity.id,
          protectKey: identity.protectKey,
          kind: call.kind,
          label: call.label,
          detail: cleared ? '已清理' : `约 ${totalTokens.toLocaleString()} token`,
          estimatedTokens: Math.max(0, totalTokens - estimateContextTokens(call.replacement)),
          protected: protectedKeys.has(identity.protectKey),
          cleared,
        })
      }
    }
  }
  return candidates
}

export async function scanContextGc(
  ccSessionId: string,
  protectedKeys: string[] = [],
): Promise<ContextGcScan> {
  const path = await transcriptPath(ccSessionId)
  const rows = parseLines(await readFile(path, 'utf8'))
  const candidates = collect(rows, new Set(protectedKeys))
  return {
    ccSessionId,
    candidates,
    estimatedTokens: candidates.reduce((sum, item) => sum + item.estimatedTokens, 0),
  }
}

function transform(rows: JsonObject[], selectedIds: Set<string>): Omit<ContextGcApplyResult, 'nextCcSessionId'> {
  let recallIndex = 0
  let releasedTokens = 0
  let candidateCount = 0
  const counts: Record<string, number> = {
    ob_recall: 0, search_chat: 0, breath: 0, web_search: 0, web_fetch: 0,
    read_bucket: 0, get_chat_context: 0, introspection: 0, read_daily_reviews: 0,
  }
  const indexes: Record<RecoverableToolKind, number> = {
    search_chat: 0, breath: 0, web_search: 0, web_fetch: 0,
    read_bucket: 0, get_chat_context: 0, introspection: 0, read_daily_reviews: 0,
  }
  const recoverableCalls = new Map<string, RecoverableCall>()

  for (const row of rows) {
    for (const slot of userTextSlots(row)) {
      const before = slot.get()
      const after = before.replace(MEMORY_CARD_RE, full => {
        const idMatch = /^\[memory_card id=([^\s\]]+)/.exec(full)
        const bucketId = bucketFromCardId(idMatch?.[1] || '')
        if (!bucketId) return full
        recallIndex += 1
        const candidateId = `ob:${recallIndex}:${hash(bucketId)}`
        if (!selectedIds.has(candidateId)) return full
        const replacement = recallReference(bucketId, cardTitle(full))
        releasedTokens += Math.max(0, estimateContextTokens(full) - estimateContextTokens(replacement))
        candidateCount += 1
        counts.ob_recall += 1
        return replacement
      })
      if (after !== before) slot.set(after)
    }
    for (const rawBlock of contentBlocks(row)) {
      const block = object(rawBlock)
      if (!block) continue
      if (block.type === 'tool_use') {
        const call = recoverableCall(block, indexes)
        const id = String(block.id || '').trim()
        if (id && call) recoverableCalls.set(id, call)
      }
      if (block.type === 'tool_result') {
        const call = recoverableCalls.get(String(block.tool_use_id || '').trim())
        if (!call) continue
        const identity = candidateIdentity(call)
        if (!selectedIds.has(identity.id)) continue
        const before = resultText(block)
        if (before == null) throw new Error(`${call.label} 返回结构无法安全瘦身`)
        setResultText(block, call.replacement)
        releasedTokens += Math.max(0, estimateContextTokens(before) - estimateContextTokens(call.replacement))
        candidateCount += 1
        counts[call.kind] += 1
      }
    }
  }
  if (candidateCount !== selectedIds.size) {
    throw new Error(`只安全识别出 ${candidateCount}/${selectedIds.size} 个所选项目，已停止减负`)
  }
  return { releasedTokens, candidateCount, counts }
}

export async function applyContextGc(
  ccSessionId: string,
  selectedIds: string[],
): Promise<ContextGcApplyResult> {
  const selected = new Set(selectedIds.filter(Boolean))
  if (selected.size === 0) throw new Error('请至少选择一项要清理的内容')
  const sourcePath = await transcriptPath(ccSessionId)
  const sourceRows = parseLines(await readFile(sourcePath, 'utf8'))
  const known = new Set(collect(sourceRows, new Set()).map(item => item.id))
  if ([...selected].some(id => !known.has(id))) throw new Error('所选项目已变化，请重新扫描')

  const fork = await forkSession(ccSessionId, { title: 'Context GC cleaned fork' })
  const forkPath = await transcriptPath(fork.sessionId)
  const forkRows = parseLines(await readFile(forkPath, 'utf8'))
  const result = transform(forkRows, selected)
  const nextText = `${forkRows.map(row => JSON.stringify(row)).join('\n')}\n`
  const tempPath = join(dirname(forkPath), `.${fork.sessionId}.${randomUUID()}.tmp`)
  await writeFile(tempPath, nextText, 'utf8')
  await rename(tempPath, forkPath)
  return { nextCcSessionId: fork.sessionId, ...result }
}

const RETENTION_MS = 24 * 60 * 60 * 1000

export type SupersededEntry = { cc_session_id: string; replaced_at: string }

export async function purgeSupersededTranscripts(
  entries: SupersededEntry[],
  activeCcSessionIds: Set<string>,
): Promise<{ deleted: string[]; skipped: string[] }> {
  const now = Date.now()
  const deleted: string[] = []
  const skipped: string[] = []
  for (const entry of entries) {
    if (activeCcSessionIds.has(entry.cc_session_id)) { skipped.push(entry.cc_session_id); continue }
    const age = now - new Date(entry.replaced_at).getTime()
    if (age < RETENTION_MS) { skipped.push(entry.cc_session_id); continue }
    try {
      const path = await transcriptPath(entry.cc_session_id)
      await unlink(path)
      deleted.push(entry.cc_session_id)
    } catch {
      skipped.push(entry.cc_session_id)
    }
  }
  return { deleted, skipped }
}

export const contextGcTest = { collect, transform }
