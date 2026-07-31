import { strFromU8, unzipSync } from 'fflate'

type PolarisManifest = {
  format?: unknown
  version?: unknown
  createdAt?: unknown
  appVersion?: unknown
}

export type PolarisConversation = {
  id?: unknown
  title?: unknown
  updatedAt?: unknown
  messages?: unknown
  [key: string]: unknown
}

type PolarisChatStore = {
  conversations?: unknown
}

export type PolarisExportPreview = {
  format: 'polaris-export'
  version: 1
  appVersion: string
  createdAt: number | null
  conversations: PolarisConversation[]
  conversationCount: number
  messageCount: number
  turnCount: number
  systemMessageCount: number
  attachmentMessageCount: number
}

const MAX_ZIP_BYTES = 50 * 1024 * 1024

function parseJson<T>(bytes: Uint8Array | undefined, label: string): T {
  if (!bytes) throw new Error(`备份中缺少 ${label}`)
  try {
    return JSON.parse(strFromU8(bytes)) as T
  } catch {
    throw new Error(`${label} 不是有效 JSON`)
  }
}

export async function readPolarisExport(file: File): Promise<PolarisExportPreview> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('ZIP 超过 50 MB，暂不支持在浏览器中导入')

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: entry => entry.name === 'manifest.json' || entry.name === 'stores/chat.json',
    })
  } catch {
    throw new Error('无法读取 ZIP，请确认它是 Polaris 原始导出文件')
  }

  const manifest = parseJson<PolarisManifest>(entries['manifest.json'], 'manifest.json')
  if (manifest.format !== 'polaris-export' || Number(manifest.version) !== 1) {
    throw new Error('只支持 Polaris export v1')
  }

  const chat = parseJson<PolarisChatStore>(entries['stores/chat.json'], 'stores/chat.json')
  if (!Array.isArray(chat.conversations)) throw new Error('chat.json 中缺少 conversations')
  const conversations = chat.conversations.filter(
    (item): item is PolarisConversation => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
  if (!conversations.length) throw new Error('备份中没有可导入的对话')

  let messageCount = 0
  let turnCount = 0
  let systemMessageCount = 0
  let attachmentMessageCount = 0
  for (const conversation of conversations) {
    if (!Array.isArray(conversation.messages)) continue
    messageCount += conversation.messages.length
    for (const message of conversation.messages) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue
      const value = message as Record<string, unknown>
      if (value.role === 'user') turnCount += 1
      if (value.role === 'system') systemMessageCount += 1
      if (Array.isArray(value.attachments) && value.attachments.length > 0) attachmentMessageCount += 1
    }
  }

  return {
    format: 'polaris-export',
    version: 1,
    appVersion: typeof manifest.appVersion === 'string' ? manifest.appVersion : '',
    createdAt: Number.isFinite(Number(manifest.createdAt)) ? Number(manifest.createdAt) : null,
    conversations,
    conversationCount: conversations.length,
    messageCount,
    turnCount,
    systemMessageCount,
    attachmentMessageCount,
  }
}
