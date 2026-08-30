import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { forkSession } from '@anthropic-ai/claude-agent-sdk'
import { estimateContextTokens } from './contextTokenEstimate'

type JsonObject = Record<string, unknown>

export type ContextGcCandidate = {
  id: string
  protectKey: string
  kind: 'ob_recall' | 'search_chat' | 'breath' | 'web_search' | 'web_fetch'
  label: string
  detail: string
  estimatedTokens: number
  protected: boolean
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
  return `[memory_ref bucket_id=${bucketId}]\ntitle: ${title}\n原召回内容已在窗口减负中清理；需要时调用 read_bucket(bucket_id=${bucketId})。\n[/memory_ref]`
}

function searchReference(query: string): string {
  return `旧的 search_chat 结果已在窗口减负中清理。曾搜索「${query}」。如有需要，请重新调用 search_chat。`
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
    replacement = `旧的 breath 结果已在窗口减负中清理。曾调用 ${label}。如有需要，请使用原工具调用中的参数重新调用 breath。`
  } else if (bareName === 'websearch' || bareName === 'web_search') {
    const query = String(input.query || input.q || '').trim()
    if (!query) return null
    kind = 'web_search'
    label = `WebSearch「${short(query, 100)}」`
    replacement = `旧的 WebSearch 结果已在窗口减负中清理。曾搜索「${query}」。如有需要，请使用原工具调用中的参数重新搜索。`
  } else if (bareName === 'webfetch' || bareName === 'web_fetch') {
    const url = String(input.url || '').trim()
    if (!url) return null
    const prompt = short(input.prompt, 160)
    kind = 'web_fetch'
    label = `WebFetch · ${short(url, 100)}`
    replacement = `旧的 WebFetch 结果已在窗口减负中清理。曾读取 ${url}${prompt ? `；原任务「${prompt}」` : ''}。如有需要，请使用原工具调用中的参数重新读取。`
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
        candidates.push({
          id: `ob:${recallIndex}:${hash(bucketId)}`,
          protectKey,
          kind: 'ob_recall',
          label: title,
          detail: `bucket_id: ${bucketId}`,
          estimatedTokens: Math.max(0, estimateContextTokens(full) - estimateContextTokens(recallReference(bucketId, title))),
          protected: protectedKeys.has(protectKey),
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
        candidates.push({
          id: identity.id,
          protectKey: identity.protectKey,
          kind: call.kind,
          label: call.label,
          detail: `${text.length.toLocaleString()} 字原始结果`,
          estimatedTokens: Math.max(0, estimateContextTokens(text) - estimateContextTokens(call.replacement)),
          protected: protectedKeys.has(identity.protectKey),
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
  }
  const indexes: Record<RecoverableToolKind, number> = {
    search_chat: 0, breath: 0, web_search: 0, web_fetch: 0,
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

export const contextGcTest = { collect, transform }
