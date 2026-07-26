// 协作者（4.5b）。配置存在 Haven 的 cc_personas 表里，通过 /api/cc-personas 读写。
//
// ⚠️ 为什么不存浏览器：localStorage 按设备 + 按浏览器各存一份 = 复刻 Polaris
// 那个「手机和 PC 两份数据」的坑。存 Haven 之后所有入口读同一份。
//
// 界面上的分工（照 Polaris，三个位置别混）：
//   对话列表左上角 → 切换协作者（本文件的列表）
//   对话列表右上角 → 当前这个协作者的设置（身份 / 提示词 / 记忆 / 引擎）
//
// ⚠️ 提示词和引擎都只在**新建对话**时生效 —— ccSession.ts 里一个会话对应一个
// 已经起好的 claude code 子进程，systemPrompt 和额度是启动参数，中途换不了。

/** 引擎 = 额度 + 请求拼装归谁。selfhost 是第 7 步的自建引擎，界面里灰着。 */
export type CcEngine = 'subscription' | 'api' | 'selfhost'

export type CcPersona = {
  id: string
  /** 显示名 */
  name: string
  /** 没有头像图时显示的字 */
  initial: string
  /** 头像底色 */
  tint: string
  /** 你希望 TA 怎么称呼你 */
  userName: string
  /** TA 如何理解自己在这里的位置 */
  purpose: string
  /** 一句话印象，只在协作者列表里显示 */
  description: string
  /** 协作者提示词，落到 systemPrompt.append */
  prompt: string
  /** 手写的记忆条目，跟提示词一起 append（分开存是为了改一条不用动整段） */
  memoryEntries: string[]
  /** 关掉就不查 OB 记忆 */
  recallOn: boolean
  /** 关掉只做关键词匹配，不跑向量检索（快，但召回少） */
  semanticOn: boolean
  engine: CcEngine
}

/** Haven 读不到时用的兜底 —— 不能让聊天页因为配置拿不到就白屏。 */
export const FALLBACK_PERSONA: CcPersona = {
  id: 'ombre',
  name: 'Ombre',
  initial: 'O',
  tint: 'var(--chat-avatar-tint)',
  userName: '',
  purpose: '',
  description: '',
  prompt: '',
  memoryEntries: [],
  recallOn: true,
  semanticOn: true,
  engine: 'api',
}

/** Haven 的 snake_case 一行 → 界面用的驼峰对象 */
export function personaFromHaven(row: Record<string, unknown>): CcPersona {
  const engine = String(row.engine || 'api')
  const entries = Array.isArray(row.memory_entries) ? row.memory_entries : []
  return {
    id: String(row.id || ''),
    name: String(row.name || '') || '未命名',
    initial: String(row.initial || '') || String(row.name || 'A').slice(0, 1).toUpperCase(),
    tint: String(row.tint || '') || FALLBACK_PERSONA.tint,
    userName: String(row.user_name || ''),
    purpose: String(row.purpose || ''),
    description: String(row.description || ''),
    prompt: String(row.prompt || ''),
    memoryEntries: entries.map(item => String(item ?? '')).filter(Boolean),
    recallOn: row.recall_on !== false,
    semanticOn: row.semantic_on !== false,
    engine: engine === 'subscription' || engine === 'selfhost' ? engine : 'api',
  }
}

/** 界面驼峰 → 提交给 /api/cc-personas 的 snake_case */
export function personaToPayload(persona: CcPersona): Record<string, unknown> {
  return {
    id: persona.id,
    name: persona.name,
    initial: persona.initial,
    tint: persona.tint,
    user_name: persona.userName,
    purpose: persona.purpose,
    description: persona.description,
    prompt: persona.prompt,
    memory_entries: persona.memoryEntries,
    recall_on: persona.recallOn,
    semantic_on: persona.semanticOn,
    engine: persona.engine,
  }
}

/** 头像底色预设。跟 :root 里的 --chat-avatar-tint 同一个调子，别写死单色。 */
export const TINT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'ombre', label: '橙', value: 'var(--chat-avatar-tint)' },
  { id: 'slate', label: '灰蓝', value: 'linear-gradient(150deg, #9AA7B8, #6E7C90)' },
  { id: 'moss', label: '苔绿', value: 'linear-gradient(150deg, #A3B892, #7A9166)' },
  { id: 'plum', label: '梅', value: 'linear-gradient(150deg, #C296A8, #9C6B80)' },
  { id: 'sand', label: '沙', value: 'linear-gradient(150deg, #DCC7A8, #BFA07A)' },
  { id: 'ink', label: '墨', value: 'linear-gradient(150deg, #6F6A66, #454240)' },
]

export const ENGINE_OPTIONS: {
  id: CcEngine
  label: string
  hint: string
  disabled?: boolean
}[] = [
  {
    id: 'subscription',
    label: 'Claude Code · 订阅额度',
    hint: '用本机 claude 的登录态。还没买会员时选它会报没凭据',
  },
  {
    id: 'api',
    label: 'Claude Code · 中转站',
    hint: '走 .env.local 里的 ANTHROPIC_BASE_URL / TOKEN。现在默认这条',
  },
  {
    id: 'selfhost',
    label: '自建引擎 · 中转站',
    hint: '只聊天、provider 可配。第 7 步做',
    disabled: true,
  },
]

/** 新建协作者时的初值 */
export function draftPersona(): CcPersona {
  const rand = Math.random().toString(36).slice(2, 8)
  return {
    ...FALLBACK_PERSONA,
    id: `p-${Date.now().toString(36)}-${rand}`,
    name: '新协作者',
    initial: 'A',
    tint: TINT_PRESETS[1].value,
  }
}
