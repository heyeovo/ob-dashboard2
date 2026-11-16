import { createHash } from 'node:crypto'
import type { GptInput } from './transport'
import type { GptAuditSnapshot } from './auditTypes'

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = (value: string) => ({ hash: hash(value), bytes: Buffer.byteLength(value, 'utf8') })

export function buildGptAudit(model: string, assembled: {
  instructions: string; input: GptInput[]; context: Record<string, unknown>
  auditParts: Record<string, string>; sourceRounds: Array<number | null>
}): GptAuditSnapshot {
  let prefix = hash(assembled.instructions)
  return {
    version: 1, algorithm: 'sha256-json-sorted-v1', model,
    body_hash: hash(canonicalJson({ model, instructions: assembled.instructions, input: assembled.input, store: false, stream: true })),
    instructions: digest(assembled.instructions),
    parts: Object.fromEntries(Object.entries(assembled.auditParts).map(([key, text]) => [key, digest(text)])),
    messages: assembled.input.map((message, index) => {
      const item = digest(canonicalJson(message))
      prefix = hash(`${prefix}\n${item.hash}`)
      return { ...item, role: message.role, source_round_id: assembled.sourceRounds[index], prefix_hash: prefix }
    }),
    context: assembled.context,
  }
}
